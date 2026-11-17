const crypto = require('node:crypto')
const admin = require('firebase-admin')
const { onRequest } = require('firebase-functions/v2/https')

admin.initializeApp()

const db = admin.firestore()
const surveyCollection = 'opinion_poll_surveys'
const responseCollection = 'opinion_poll_responses'
const statisticCollection = 'opinion_poll_statistics'
const maxTextLength = 1000

function fail(status, message) {
  const error = new Error(message)
  error.status = status
  throw error
}

function cleanText(value, maxLength, label, required = false) {
  if (typeof value !== 'string') {
    if (required) fail(400, `${label}為必填欄位。`)
    return ''
  }
  const text = value.trim()
  if (required && !text) fail(400, `${label}為必填欄位。`)
  if (text.length > maxLength) fail(400, `${label}超過字數限制。`)
  return text
}

function normalizeQuestions(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) fail(400, '調查必須包含 1 到 30 題。')
  const questions = value.map((question, index) => {
    const id = typeof question.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(question.id) ? question.id : crypto.randomUUID()
    const type = ['single', 'multiple', 'text'].includes(question.type) ? question.type : null
    if (!type) fail(400, `第 ${index + 1} 題的題型不正確。`)
    const title = cleanText(question.title, 200, `第 ${index + 1} 題`, true)
    const required = question.required !== false
    let options = []
    if (type !== 'text') {
      if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 20) fail(400, `第 ${index + 1} 題至少需要 2 個選項。`)
      options = question.options.map((option, optionIndex) => ({
        id: typeof option.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(option.id) ? option.id : crypto.randomUUID(),
        text: cleanText(option.text, 100, `第 ${index + 1} 題的選項 ${optionIndex + 1}`, true),
      }))
      if (new Set(options.map((item) => item.id)).size !== options.length) fail(400, `第 ${index + 1} 題有重複選項。`)
    }
    return { id, type, title, required, options }
  })
  if (new Set(questions.map((question) => question.id)).size !== questions.length) fail(400, '調查題目識別碼重複。')
  return questions
}

function isoDate(value) {
  if (value == null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) fail(400, '截止時間格式不正確。')
  return date.toISOString()
}

function surveyRef(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) fail(400, '調查網址不正確。')
  return db.collection(surveyCollection).doc(id)
}

function publicSurvey(data) {
  const { manageTokenHash, ...safe } = data
  return safe
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function requireManager(ref, token) {
  if (typeof token !== 'string' || token.length < 30) fail(403, '管理連結無效或已遺失。')
  const snapshot = await ref.get()
  if (!snapshot.exists) fail(404, '找不到這份調查。')
  const expected = snapshot.data().manageTokenHash
  const actual = tokenHash(token)
  const a = Buffer.from(expected || '', 'hex')
  const b = Buffer.from(actual, 'hex')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail(403, '管理連結無效或已遺失。')
  return snapshot
}

async function createSurvey(body) {
  const title = cleanText(body.title, 100, '調查標題', true)
  const description = cleanText(body.description ?? '', 500, '調查說明')
  const questions = normalizeQuestions(body.questions)
  const opensAt = isoDate(body.opensAt)
  const closesAt = isoDate(body.closesAt)
  if (opensAt && closesAt && new Date(closesAt).getTime() <= new Date(opensAt).getTime()) fail(400, '截止時間需要晚於開始時間。')
  const id = db.collection(surveyCollection).doc().id
  const token = crypto.randomBytes(32).toString('base64url')
  const ref = surveyRef(id)
  const survey = {
    id, title, description, questions, status: 'open', resultsPublic: body.resultsPublic === true,
    opensAt, closesAt, createdAt: new Date().toISOString(), responseCount: 0,
    manageTokenHash: tokenHash(token),
  }
  const batch = db.batch()
  batch.create(ref, survey)
  for (const question of questions) {
    const counts = Object.fromEntries(question.options.map((option) => [option.id, 0]))
    batch.create(ref.collection(statisticCollection).doc(question.id), { questionId: question.id, counts, textCount: 0 })
  }
  await batch.commit()
  return { id, token }
}

function validateAnswers(survey, body) {
  const answers = body.answers
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail(400, '回答格式不正確。')
  const cleaned = {}
  for (const question of survey.questions) {
    const value = answers[question.id]
    if (question.type === 'text') {
      const answer = typeof value === 'string' ? value.trim() : ''
      if (question.required && !answer) fail(400, `請回答「${question.title}」。`)
      if (answer.length > maxTextLength) fail(400, `「${question.title}」回答超過字數限制。`)
      if (answer) cleaned[question.id] = answer
    } else if (question.type === 'single') {
      if (value == null || value === '') {
        if (question.required) fail(400, `請回答「${question.title}」。`)
        continue
      }
      if (typeof value !== 'string' || !question.options.some((option) => option.id === value)) fail(400, `「${question.title}」的選項不正確。`)
      cleaned[question.id] = value
    } else {
      const selected = value == null ? [] : value
      if (!Array.isArray(selected) || selected.some((item) => typeof item !== 'string')) fail(400, `「${question.title}」的回答格式不正確。`)
      if (question.required && selected.length === 0) fail(400, `請回答「${question.title}」。`)
      if (new Set(selected).size !== selected.length || selected.some((id) => !question.options.some((option) => option.id === id))) fail(400, `「${question.title}」的選項不正確。`)
      if (selected.length) cleaned[question.id] = selected
    }
  }
  return cleaned
}

async function submitResponse(body) {
  const ref = surveyRef(body.id)
  const snapshot = await ref.get()
  if (!snapshot.exists) fail(404, '找不到這份調查。')
  const survey = snapshot.data()
  if (survey.status !== 'open') fail(410, '這份調查已停止接受回答。')
  if (survey.opensAt && Date.now() < new Date(survey.opensAt).getTime()) fail(410, '這份調查尚未開放。')
  if (survey.closesAt && Date.now() > new Date(survey.closesAt).getTime()) fail(410, '這份調查已截止。')
  const answers = validateAnswers(survey, body)
  const nickname = cleanText(body.nickname ?? '', 40, '暱稱')
  const responseRef = ref.collection(responseCollection).doc()
  const batch = db.batch()
  batch.create(responseRef, { nickname, answers, submittedAt: new Date().toISOString() })
  batch.update(ref, { responseCount: admin.firestore.FieldValue.increment(1) })
  for (const question of survey.questions) {
    const value = answers[question.id]
    const statisticRef = ref.collection(statisticCollection).doc(question.id)
    if (question.type === 'text') {
      if (value) batch.update(statisticRef, { textCount: admin.firestore.FieldValue.increment(1) })
    } else {
      const selected = Array.isArray(value) ? value : value ? [value] : []
      const increments = {}
      for (const optionId of selected) increments[`counts.${optionId}`] = admin.firestore.FieldValue.increment(1)
      if (Object.keys(increments).length) batch.update(statisticRef, increments)
    }
  }
  await batch.commit()
  return { submitted: true }
}

async function manageSurvey(body, token) {
  const ref = surveyRef(body.id)
  const snapshot = await requireManager(ref, token)
  const survey = snapshot.data()
  const [statsSnapshot, responsesSnapshot] = await Promise.all([
    ref.collection(statisticCollection).get(),
    ref.collection(responseCollection).orderBy('submittedAt', 'desc').limit(100).get(),
  ])
  const stats = Object.fromEntries(statsSnapshot.docs.map((doc) => [doc.id, doc.data()]))
  const responses = responsesSnapshot.docs.map((doc) => doc.data())
  return { survey: publicSurvey(survey), stats, responses }
}

async function updateSurvey(body, token) {
  const ref = surveyRef(body.id)
  const snapshot = await requireManager(ref, token)
  const changes = body.changes && typeof body.changes === 'object' ? body.changes : {}
  const patch = {}
  if ('title' in changes) patch.title = cleanText(changes.title, 100, '調查標題', true)
  if ('description' in changes) patch.description = cleanText(changes.description, 500, '調查說明')
  if ('status' in changes) {
    if (!['open', 'closed'].includes(changes.status)) fail(400, '調查狀態不正確。')
    patch.status = changes.status
  }
  if ('resultsPublic' in changes) patch.resultsPublic = changes.resultsPublic === true
  if ('closesAt' in changes) patch.closesAt = isoDate(changes.closesAt)
  if ('questions' in changes) {
    if ((snapshot.data().responseCount ?? 0) > 0) fail(409, '已有回答後無法修改題目，以免影響統計。')
    const questions = normalizeQuestions(changes.questions)
    patch.questions = questions
    const stats = await ref.collection(statisticCollection).get()
    const batch = db.batch()
    stats.docs.forEach((doc) => batch.delete(doc.ref))
    for (const question of questions) {
      const counts = Object.fromEntries(question.options.map((option) => [option.id, 0]))
      batch.create(ref.collection(statisticCollection).doc(question.id), { questionId: question.id, counts, textCount: 0 })
    }
    Object.assign(patch, { updatedAt: new Date().toISOString() })
    batch.update(ref, patch)
    await batch.commit()
  } else {
    patch.updatedAt = new Date().toISOString()
    await ref.update(patch)
  }
  const latest = await ref.get()
  return { survey: publicSurvey(latest.data()) }
}

async function publicResults(body) {
  const ref = surveyRef(body.id)
  const snapshot = await ref.get()
  if (!snapshot.exists) fail(404, '找不到這份調查。')
  const survey = snapshot.data()
  if (survey.resultsPublic !== true) fail(403, '這份調查未公開統計。')
  const statsSnapshot = await ref.collection(statisticCollection).get()
  return { survey: { id: survey.id, title: survey.title, questions: survey.questions, responseCount: survey.responseCount }, stats: Object.fromEntries(statsSnapshot.docs.map((doc) => [doc.id, doc.data()])) }
}

exports.opinionPollApi = onRequest({ region: 'asia-east1', cors: true, maxInstances: 10 }, async (req, res) => {
  try {
    const body = req.method === 'GET' ? req.query : req.body || {}
    const action = typeof body.action === 'string' ? body.action : ''
    const id = body.id
    if (action === 'createSurvey' && req.method === 'POST') return res.status(201).json(await createSurvey(body))
    if (action === 'getSurvey' && req.method === 'GET') {
      const snapshot = await surveyRef(id).get()
      if (!snapshot.exists) fail(404, '找不到這份調查。')
      return res.json({ survey: publicSurvey(snapshot.data()), resultsPublic: snapshot.data().resultsPublic === true })
    }
    if (action === 'submitResponse' && req.method === 'POST') return res.status(201).json(await submitResponse(body))
    if (action === 'manageSurvey' && req.method === 'GET') return res.json(await manageSurvey(body, req.get('x-manage-token')))
    if (action === 'updateSurvey' && req.method === 'POST') return res.json(await updateSurvey(body, req.get('x-manage-token')))
    if (action === 'publicResults' && req.method === 'GET') return res.json(await publicResults(body))
    fail(404, '找不到這項操作。')
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500
    if (status === 500) console.error('opinionPollApi error:', error)
    return res.status(status).json({ error: status === 500 ? '伺服器發生錯誤，請稍後再試。' : error.message })
  }
})
