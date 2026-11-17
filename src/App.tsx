import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import {
  ArrowRight, BarChart3, Check, CheckCircle2, ChevronDown, CircleHelp,
  Clock3, Copy, Download, ExternalLink, FileText, Link2, ListChecks,
  LockKeyhole, MessageCircle, Plus, QrCode, Radio, Send, Settings2, ShieldCheck,
  Sparkles, Trash2, Type, Users, X,
} from 'lucide-react'
import './App.css'

type QuestionType = 'single' | 'multiple' | 'text'
type Option = { id: string; text: string }
type Question = { id: string; type: QuestionType; title: string; required: boolean; options: Option[] }
type Survey = {
  id: string; title: string; description: string; status: 'open' | 'closed';
  questions: Question[]; resultsPublic: boolean; opensAt?: string; closesAt?: string;
  responseCount?: number; createdAt?: string;
}
type Response = { nickname?: string; answers: Record<string, string | string[]>; submittedAt: string }
type Statistic = { counts?: Record<string, number>; textCount?: number }
type Route = { page: 'home' | 'poll' | 'manage' | 'done' | 'results'; id?: string; token?: string }

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://opinionpollapi-l4atah6fzq-de.a.run.app'
const basePath = import.meta.env.BASE_URL
const makeId = () => crypto.randomUUID()
const blankQuestion = (): Question => ({ id: makeId(), type: 'single', title: '', required: true, options: [{ id: makeId(), text: '' }, { id: makeId(), text: '' }] })

function readRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const [page, id] = path.split('/')
  const params = new URLSearchParams(query)
  if (page === 'poll' && id) return { page: 'poll', id }
  if (page === 'manage' && id) return { page: 'manage', id, token: params.get('key') ?? undefined }
  if (page === 'done') return { page: 'done', id }
  if (page === 'results' && id) return { page: 'results', id }
  return { page: 'home' }
}

function routeTo(hash: string) {
  window.location.hash = hash
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function publicUrl(id: string) {
  return `${window.location.origin}${basePath}#/poll/${id}`
}

async function api<T>(action: string, payload?: unknown, token?: string, method: 'GET' | 'POST' = 'POST'): Promise<T> {
  if (!API_URL) throw new Error('網站尚未設定 Firebase Functions 網址，請稍後再試。')
  const url = new URL(API_URL)
  if (method === 'GET') {
    url.searchParams.set('action', action)
    const body = payload as Record<string, string> | undefined
    Object.entries(body ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))
  }
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-manage-token': token } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify({ action, ...payload as object }) } : {}),
  })
  const result = await response.json() as { error?: string } & T
  if (!response.ok) throw new Error(result.error || '連線失敗，請稍後再試。')
  return result
}

function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  useEffect(() => {
    const update = () => setRoute(readRoute())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  return <div className="app-shell">
    <Header onHome={() => routeTo('')} />
    {route.page === 'home' && <Builder />}
    {route.page === 'poll' && route.id && <PollPage id={route.id} />}
    {route.page === 'manage' && route.id && <ManagePage id={route.id} token={route.token ?? ''} />}
    {route.page === 'done' && <DonePage id={route.id} />}
    {route.page === 'results' && route.id && <PublicResultsPage id={route.id} />}
    <Footer />
  </div>
}

function Header({ onHome }: { onHome: () => void }) {
  return <header className="topbar"><button className="brand" onClick={onHome} aria-label="回首頁">
    <span className="brand-mark"><Radio size={21} strokeWidth={2.4} /></span>
    <span>聚點<span className="brand-dot">.</span></span>
  </button><div className="header-note"><span className="live-dot" />匿名參與 · 即時統計</div></header>
}

function Footer() {
  return <footer className="footer"><span>聚點 Poll Studio</span><span>讓每個想法，都有一個位置。</span></footer>
}

function Builder() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [questions, setQuestions] = useState<Question[]>([blankQuestion()])
  const [allowResults, setAllowResults] = useState(false)
  const [openingDate, setOpeningDate] = useState('')
  const [closingDate, setClosingDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function updateQuestion(id: string, update: Partial<Question>) {
    setQuestions((items) => items.map((q) => q.id === id ? { ...q, ...update } : q))
  }
  function updateOption(questionId: string, optionId: string, text: string) {
    setQuestions((items) => items.map((q) => q.id === questionId ? { ...q, options: q.options.map((o) => o.id === optionId ? { ...o, text } : o) } : q))
  }
  function changeType(question: Question, type: QuestionType) {
    updateQuestion(question.id, { type, options: type === 'text' ? [] : question.options.length ? question.options : [{ id: makeId(), text: '' }, { id: makeId(), text: '' }] })
  }
  async function publish() {
    setError('')
    if (!title.trim()) return setError('請先填寫調查標題。')
    if (!questions.length || questions.some((q) => !q.title.trim())) return setError('每一題都需要填寫題目內容。')
    if (questions.some((q) => q.type !== 'text' && (q.options.length < 2 || q.options.some((o) => !o.text.trim())))) return setError('單選與複選題至少需要兩個完整選項。')
    if (openingDate && new Date(openingDate).getTime() <= Date.now()) return setError('開始時間需要晚於現在。')
    if (openingDate && closingDate && new Date(closingDate).getTime() <= new Date(openingDate).getTime()) return setError('截止時間需要晚於開始時間。')
    if (!openingDate && closingDate && new Date(closingDate).getTime() <= Date.now()) return setError('截止時間需要晚於現在。')
    setBusy(true)
    try {
      const payload = await api<{ id: string; token: string }>('createSurvey', {
        title: title.trim(), description: description.trim(), questions: questions.map((q) => ({ ...q, title: q.title.trim(), options: q.options.map((o) => ({ ...o, text: o.text.trim() })) })),
        resultsPublic: allowResults, opensAt: openingDate ? new Date(openingDate).toISOString() : null, closesAt: closingDate ? new Date(closingDate).toISOString() : null,
      })
      routeTo(`/manage/${payload.id}?key=${encodeURIComponent(payload.token)}`)
    } catch (e) { setError(e instanceof Error ? e.message : '建立失敗，請稍後再試。') }
    finally { setBusy(false) }
  }

  return <main className="main-wrap builder-page">
    <section className="hero">
      <div className="eyebrow"><Sparkles size={14} /> CLASSROOM POLL STUDIO</div>
      <h1>每個想法，<span>都值得被聽見。</span></h1>
      <p>建立你的班級調查，分享連結或 QR code，讓大家一起加入討論。</p>
      <div className="hero-points"><span><CheckCircle2 size={15} />免登入參與</span><span><CheckCircle2 size={15} />題型自由搭配</span><span><CheckCircle2 size={15} />回答次數不限</span></div>
    </section>

    <div className="builder-layout">
      <section className="form-column">
        <div className="section-heading"><div><span className="section-kicker">STEP 01</span><h2>調查內容</h2></div><span className="soft-badge"><FileText size={14} />基本資料</span></div>
        <div className="panel basic-panel">
          <label className="field-label" htmlFor="survey-title">調查標題 <span className="required-star">*</span></label>
          <input id="survey-title" className="text-input title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：班級畢業旅行目的地票選" maxLength={100} />
          <label className="field-label spaced" htmlFor="survey-description">調查說明 <span className="optional">選填</span></label>
          <textarea id="survey-description" className="text-input description-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="告訴大家這份調查的目的或填答提醒…" maxLength={500} rows={3} />
        </div>

        <div className="section-heading question-heading"><div><span className="section-kicker">STEP 02</span><h2>設計題目 <small>{questions.length} 題</small></h2></div><span className="soft-badge"><ListChecks size={14} />可混合題型</span></div>
        <div className="question-stack">{questions.map((question, index) => <article className="panel question-card" key={question.id}>
          <div className="question-card-top"><div className="question-number">{String(index + 1).padStart(2, '0')}</div><div className="question-type-select"><span>題型</span><select value={question.type} onChange={(e) => changeType(question, e.target.value as QuestionType)} aria-label={`第 ${index + 1} 題題型`}><option value="single">單選題</option><option value="multiple">複選題</option><option value="text">文字回答</option></select><ChevronDown size={14} /></div><button className="icon-button remove-button" title="刪除題目" onClick={() => questions.length > 1 && setQuestions((items) => items.filter((q) => q.id !== question.id))} disabled={questions.length === 1}><Trash2 size={16} /></button></div>
          <label className="sr-only" htmlFor={`question-${question.id}`}>題目文字</label>
          <input id={`question-${question.id}`} className="text-input question-input" value={question.title} onChange={(e) => updateQuestion(question.id, { title: e.target.value })} placeholder="輸入你的問題…" maxLength={200} />
          {question.type !== 'text' ? <div className="options-list">{question.options.map((option, optionIndex) => <div className="option-row" key={option.id}>
            <span className={`choice-glyph ${question.type === 'multiple' ? 'square' : ''}`} />
            <input className="option-input" value={option.text} onChange={(e) => updateOption(question.id, option.id, e.target.value)} placeholder={`選項 ${optionIndex + 1}`} maxLength={100} aria-label={`選項 ${optionIndex + 1}`} />
            <button className="option-remove" aria-label="移除選項" disabled={question.options.length <= 2} onClick={() => updateQuestion(question.id, { options: question.options.filter((item) => item.id !== option.id) })}><X size={15} /></button>
          </div>)}<button className="add-option" onClick={() => updateQuestion(question.id, { options: [...question.options, { id: makeId(), text: '' }] })}><Plus size={15} />新增選項</button></div> : <div className="text-answer-preview"><Type size={15} />填答者可輸入文字回答</div>}
          <div className="question-card-bottom"><label className="toggle-line"><input type="checkbox" checked={question.required} onChange={(e) => updateQuestion(question.id, { required: e.target.checked })} /><span className="toggle-control" /><span>必填</span></label><span className="question-footnote">{question.type === 'multiple' ? '可選擇多個答案' : question.type === 'single' ? '限選一個答案' : '暱稱將與回答一起保存'}</span></div>
        </article>)}</div>
        <button className="add-question" onClick={() => setQuestions((items) => [...items, blankQuestion()])}><span><Plus size={18} /></span>新增一題</button>

        <div className="section-heading settings-heading"><div><span className="section-kicker">STEP 03</span><h2>調查設定</h2></div><span className="soft-badge"><Settings2 size={14} />依需求調整</span></div>
        <div className="panel settings-panel">
          <label className="setting-row"><span className="setting-icon"><Clock3 size={17} /></span><span className="setting-copy"><strong>設定開始時間</strong><small>留白代表建立後立即開放</small></span><input aria-label="調查開始時間" className="date-input" type="datetime-local" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} /></label>
          <div className="setting-divider" />
          <label className="setting-row"><span className="setting-icon"><Clock3 size={17} /></span><span className="setting-copy"><strong>設定截止時間</strong><small>留白代表不設定截止時間</small></span><input aria-label="調查截止時間" className="date-input" type="datetime-local" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} /></label>
          <div className="setting-divider" />
          <label className="setting-row"><span className="setting-icon"><BarChart3 size={17} /></span><span className="setting-copy"><strong>填答後公開統計</strong><small>關閉時只有管理者可以查看結果</small></span><input className="switch-input" type="checkbox" checked={allowResults} onChange={(e) => setAllowResults(e.target.checked)} aria-label="填答後公開統計" /></label>
        </div>
        {error && <div className="inline-error" role="alert"><CircleHelp size={16} />{error}</div>}
        <div className="publish-row"><p><ShieldCheck size={15} />不需要登入，即可建立與參與調查。</p><button className="primary-button" onClick={publish} disabled={busy}>{busy ? '正在建立…' : '建立調查'}<ArrowRight size={17} /></button></div>
      </section>
      <aside className="side-column"><div className="preview-card"><div className="preview-top"><span className="preview-icon"><QrCode size={18} /></span><span className="preview-label">分享方式</span></div><h3>掃碼即可開始</h3><p>建立完成後，會自動產生專屬 QR code。放到投影幕或講義上，大家掃描就能填答。</p><div className="qr-placeholder"><div className="qr-pattern"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><span>QR CODE</span></div><div className="preview-link"><Link2 size={14} /><span>每份調查都有專屬網址</span></div></div>
        <div className="privacy-note"><span className="privacy-icon"><LockKeyhole size={16} /></span><div><strong>簡單、安全地分享</strong><p>填答者不需提供帳號。管理者會收到專屬管理連結，請妥善保存。</p></div></div>
        <div className="feature-note"><div><Users size={16} />無限次提交</div><div><MessageCircle size={16} />暱稱選填</div><div><BarChart3 size={16} />回答即時統計</div></div>
      </aside>
    </div>
  </main>
}

function PollPage({ id }: { id: string }) {
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api<{ survey: Survey }>('getSurvey', { id }, undefined, 'GET').then((r) => setSurvey(r.survey)).catch((e) => setError(e.message)).finally(() => setLoading(false)) }, [id])
  function choose(question: Question, optionId: string) {
    setAnswers((prev) => {
      if (question.type === 'single') return { ...prev, [question.id]: optionId }
      const values = Array.isArray(prev[question.id]) ? prev[question.id] as string[] : []
      return { ...prev, [question.id]: values.includes(optionId) ? values.filter((value) => value !== optionId) : [...values, optionId] }
    })
  }
  async function submit() {
    if (!survey) return
    setError('')
    const missing = survey.questions.some((q) => q.required && (q.type === 'text' ? !(typeof answers[q.id] === 'string' && (answers[q.id] as string).trim()) : !answers[q.id] || (Array.isArray(answers[q.id]) && !(answers[q.id] as string[]).length)))
    if (missing) return setError('還有必填題目尚未回答。')
    setBusy(true)
    try { await api('submitResponse', { id, nickname: nickname.trim(), answers }); routeTo(`/done/${id}`) }
    catch (e) { setError(e instanceof Error ? e.message : '送出失敗，請稍後再試。') }
    finally { setBusy(false) }
  }
  if (loading) return <main className="main-wrap centered-state"><div className="spinner" /><p>正在載入調查…</p></main>
  if (error && !survey) return <main className="main-wrap centered-state"><div className="state-icon error-state"><CircleHelp /></div><h1>找不到這份調查</h1><p>{error}</p><a href={basePath} className="primary-button link-button">回到首頁<ArrowRight size={16} /></a></main>
  if (!survey) return null
  if (survey.status === 'closed') return <main className="main-wrap centered-state"><div className="state-icon"><Clock3 /></div><div className="eyebrow">SURVEY CLOSED</div><h1>這份調查已結束</h1><p>感謝你的關注，這份調查目前已停止接受回答。</p></main>
  if (survey.opensAt && Date.now() < new Date(survey.opensAt).getTime()) return <main className="main-wrap centered-state"><div className="state-icon"><Clock3 /></div><div className="eyebrow">COMING SOON</div><h1>調查尚未開放</h1><p>預計於 {formatDate(survey.opensAt)} 開始接受回答，請稍後再回來。</p></main>
  return <main className="main-wrap poll-page"><div className="poll-progress"><span>CLASSROOM POLL</span><span><Users size={14} />匿名參與</span></div><div className="poll-card panel">
    <div className="poll-accent" /><div className="poll-content"><div className="poll-meta"><span className="open-tag"><i />進行中</span><span>{survey.questions.length} 題</span></div><h1>{survey.title}</h1>{survey.description && <p className="poll-description">{survey.description}</p>}
      <div className="nickname-field"><label htmlFor="nickname">填答暱稱 <span>選填</span></label><input id="nickname" className="text-input" value={nickname} onChange={(e) => setNickname(e.target.value.slice(0, 40))} placeholder="輸入暱稱，或留白匿名作答" maxLength={40} /></div>
      {survey.questions.map((q, index) => <section className="answer-question" key={q.id}><div className="answer-question-title"><span>{String(index + 1).padStart(2, '0')}</span><h2>{q.title}<b className={q.required ? '' : 'muted'}>{q.required ? '必填' : '選填'}</b></h2></div>
        {q.type === 'text' ? <textarea className="text-input answer-textarea" rows={4} placeholder="寫下你的回答…" value={typeof answers[q.id] === 'string' ? answers[q.id] as string : ''} onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))} maxLength={1000} /> : <div className="answer-options">{q.options.map((option) => { const checked = q.type === 'multiple' ? (answers[q.id] as string[] | undefined)?.includes(option.id) : answers[q.id] === option.id; return <button type="button" className={`answer-option ${checked ? 'selected' : ''}`} key={option.id} onClick={() => choose(q, option.id)}><span className={`answer-control ${q.type === 'multiple' ? 'check-control' : ''}`}>{checked && <Check size={13} />}</span><span>{option.text}</span></button> })}</div>}
      </section>)}
      {error && <div className="inline-error"><CircleHelp size={16} />{error}</div>}
      <button className="primary-button submit-button" onClick={submit} disabled={busy}>{busy ? '正在送出…' : '送出回答'}<Send size={16} /></button><p className="vote-note"><ShieldCheck size={14} />匿名填答 · 可重複提交</p>
    </div>
  </div><div className="poll-bottom-note"><LockKeyhole size={14} />你的回答會安全儲存，只有調查建立者可以查看。</div></main>
}

function DonePage({ id }: { id?: string }) {
  const [showResults, setShowResults] = useState(false)
  useEffect(() => { if (!id) return; api<{ resultsPublic: boolean }>('getSurvey', { id }, undefined, 'GET').then((r) => setShowResults(r.resultsPublic)).catch(() => undefined) }, [id])
  return <main className="main-wrap centered-state done-state"><div className="done-check"><Check size={34} /></div><div className="eyebrow">RESPONSE RECEIVED</div><h1>謝謝你分享想法！</h1><p>你的回答已經送出，讓這份調查更完整。</p>{showResults && id && <button className="text-button" onClick={() => routeTo(`/results/${id}`)}>查看調查結果<ArrowRight size={15} /></button>}<button className="ghost-button" onClick={() => routeTo('')}>建立一份自己的調查</button></main>
}

function PublicResultsPage({ id }: { id: string }) {
  const [data, setData] = useState<{ survey: Survey; stats: Record<string, Statistic> } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<{ survey: Survey; stats: Record<string, Statistic> }>('publicResults', { id }, undefined, 'GET').then(setData).catch((e) => setError(e.message)) }, [id])
  if (error) return <main className="main-wrap centered-state"><div className="state-icon"><BarChart3 /></div><h1>目前無法查看結果</h1><p>{error}</p><button className="ghost-button" onClick={() => routeTo('')}>回首頁</button></main>
  if (!data) return <main className="main-wrap centered-state"><div className="spinner" /><p>正在整理調查結果…</p></main>
  return <main className="main-wrap manage-page public-results-page"><div className="eyebrow"><BarChart3 size={14} /> PUBLIC RESULTS</div><div className="results-heading public-results-heading"><div><h1>{data.survey.title}</h1><p>目前共收到 {data.survey.responseCount ?? 0} 份回答</p></div><span className="result-count"><Users size={14} />公開統計</span></div><div className="result-list">{data.survey.questions.map((question, index) => {
    const stat = data.stats[question.id] ?? {}
    return <article className="panel result-card" key={question.id}><div className="result-card-head"><div className="question-number">{String(index + 1).padStart(2, '0')}</div><div><h3>{question.title}</h3><span>{question.type === 'single' ? '單選題' : question.type === 'multiple' ? '複選題' : '文字回答'}</span></div></div>{question.type === 'text' ? <p className="public-text-result">文字回答僅供調查建立者查看。</p> : <div className="bar-list">{question.options.map((option) => { const value = stat.counts?.[option.id] ?? 0; const percent = (data.survey.responseCount ?? 0) ? Math.round(value / (data.survey.responseCount ?? 1) * 100) : 0; return <div className="bar-row" key={option.id}><div className="bar-label"><span>{option.text}</span><strong>{value}<small> 票 · {percent}%</small></strong></div><div className="bar-track"><span style={{ width: `${percent}%` }} /></div></div> })}</div>}</article>
  })}</div></main>
}

function ManagePage({ id, token }: { id: string; token: string }) {
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [stats, setStats] = useState<Record<string, Statistic>>({})
  const [responses, setResponses] = useState<Response[]>([])
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [adminCopied, setAdminCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const link = useMemo(() => publicUrl(id), [id])
  useEffect(() => {
    if (!token) { setError('管理連結缺少存取權杖，請使用建立調查時保存的管理連結。'); return }
    Promise.all([api<{ survey: Survey; stats: Record<string, Statistic>; responses: Response[] }>('manageSurvey', { id }, token, 'GET'), QRCode.toDataURL(link, { width: 280, margin: 1, color: { dark: '#14213d', light: '#ffffff' }, errorCorrectionLevel: 'H' })])
      .then(([data, qrImage]) => { setSurvey(data.survey); setEditTitle(data.survey.title); setEditDescription(data.survey.description); setStats(data.stats); setResponses(data.responses); setQr(qrImage) }).catch((e) => setError(e.message))
  }, [id, token, link])
  async function copyLink() { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 1800) }
  async function copyAdminLink() { await navigator.clipboard.writeText(window.location.href); setAdminCopied(true); window.setTimeout(() => setAdminCopied(false), 1800) }
  function downloadQr() { const a = document.createElement('a'); a.href = qr; a.download = 'survey-qr-code.png'; a.click() }
  async function changeStatus() {
    if (!survey) return
    setSaving(true); setNotice('')
    try { const status = survey.status === 'open' ? 'closed' : 'open'; const result = await api<{ survey: Survey }>('updateSurvey', { id, changes: { status } }, token); setSurvey(result.survey); setNotice(status === 'closed' ? '調查已關閉。' : '調查已重新開放。') }
    catch (e) { setNotice(e instanceof Error ? e.message : '更新失敗。') } finally { setSaving(false) }
  }
  async function saveDetails() {
    setSaving(true); setNotice('')
    try { const result = await api<{ survey: Survey }>('updateSurvey', { id, changes: { title: editTitle.trim(), description: editDescription.trim() } }, token); setSurvey((previous) => previous ? { ...previous, ...result.survey } : result.survey); setEditing(false); setNotice('調查內容已更新。') }
    catch (e) { setNotice(e instanceof Error ? e.message : '更新失敗。') } finally { setSaving(false) }
  }
  if (error && !survey) return <main className="main-wrap centered-state"><div className="state-icon error-state"><LockKeyhole /></div><h1>無法開啟管理頁</h1><p>{error}</p><button className="ghost-button" onClick={() => routeTo('')}>回首頁</button></main>
  if (!survey) return <main className="main-wrap centered-state"><div className="spinner" /><p>正在載入管理資料…</p></main>
  return <main className="main-wrap manage-page">
    <div className="manage-title-row"><div><div className="eyebrow"><BarChart3 size={14} /> SURVEY DASHBOARD</div><h1>調查管理</h1><p>查看回答、分享調查，或調整開放狀態。</p></div><div className="manage-title-actions"><button className="ghost-button" onClick={() => setEditing((value) => !value)}><Settings2 size={14} />編輯內容</button><button className={`status-button ${survey.status}`} onClick={changeStatus} disabled={saving}><span />{saving ? '更新中…' : survey.status === 'open' ? '進行中' : '已關閉'}<ChevronDown size={14} /></button></div></div>
    {editing && <section className="panel edit-survey-panel"><div className="edit-survey-head"><div><span className="section-kicker">EDIT SURVEY</span><h2>調查基本資料</h2></div><button className="icon-button" onClick={() => setEditing(false)} aria-label="關閉編輯"><X size={17} /></button></div><label className="field-label" htmlFor="edit-title">調查標題</label><input id="edit-title" className="text-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={100} /><label className="field-label spaced" htmlFor="edit-description">調查說明 <span className="optional">選填</span></label><textarea id="edit-description" className="text-input description-input" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} maxLength={500} /><div className="edit-actions"><span>回答進來後，題目與選項會鎖定以保留統計一致性。</span><button className="primary-button" onClick={saveDetails} disabled={saving || !editTitle.trim()}>{saving ? '儲存中…' : '儲存變更'}<Check size={15} /></button></div></section>}
    <section className="manage-share-grid"><div className="panel share-panel"><div className="share-panel-heading"><div><span className="section-kicker">SHARE YOUR POLL</span><h2>邀請大家參與</h2></div><span className="share-heading-icon"><QrCode size={19} /></span></div><p className="share-description">掃描 QR code 即可直接填答，也可以複製連結傳給大家。</p><div className="share-content"><div className="qr-frame">{qr && <img src={qr} alt="調查填答 QR code" />}</div><div className="share-actions"><button className="share-url" onClick={copyLink}><span><Link2 size={15} />{link}</span>{copied ? <Check size={16} /> : <Copy size={15} />}</button><button className="secondary-button" onClick={downloadQr}><Download size={15} />下載 QR code</button><a className="text-button" href={link} target="_blank" rel="noreferrer">開啟填答頁<ExternalLink size={14} /></a></div></div><div className="admin-link-note"><span><LockKeyhole size={14} />管理連結僅供建立者使用，請勿公開分享。</span><button onClick={copyAdminLink}>{adminCopied ? '已複製' : '複製管理連結'}<Copy size={13} /></button></div></div>
      <aside className="panel response-total"><span className="total-icon"><Users size={19} /></span><span className="total-label">累積回答</span><strong>{survey.responseCount ?? 0}</strong><span className="total-footnote">不限制提交次數</span><div className="total-decoration"><span /><span /><span /><span /><span /></div></aside>
    </section>
    {notice && <div className="inline-notice"><CheckCircle2 size={16} />{notice}</div>}
    <section className="results-section"><div className="results-heading"><div><span className="section-kicker">RESPONSE INSIGHTS</span><h2>回答結果</h2></div><span className="result-count"><Users size={14} />{survey.responseCount ?? 0} 份回答</span></div>
      {!survey.responseCount ? <div className="panel empty-results"><span className="empty-icon"><MessageCircle size={23} /></span><h3>等待第一份回答</h3><p>把上方連結或 QR code 分享出去，回答進來後會顯示在這裡。</p></div> : <div className="result-list">{survey.questions.map((q, index) => {
        const stat = stats[q.id] ?? {}; const count = q.type === 'text' ? stat.textCount ?? 0 : Object.values(stat.counts ?? {}).reduce((sum, n) => sum + n, 0)
        return <article className="panel result-card" key={q.id}><div className="result-card-head"><div className="question-number">{String(index + 1).padStart(2, '0')}</div><div><h3>{q.title}</h3><span>{q.type === 'single' ? '單選題' : q.type === 'multiple' ? '複選題' : '文字回答'} · {count} 份回答</span></div></div>
          {q.type === 'text' ? <div className="text-responses">{responses.filter((r) => typeof r.answers[q.id] === 'string' && (r.answers[q.id] as string).trim()).slice(0, 8).map((r, i) => <div className="text-response" key={`${r.submittedAt}-${i}`}><p>{r.answers[q.id] as string}</p><span>{r.nickname?.trim() || '匿名'} · {formatDate(r.submittedAt)}</span></div>)}{count > 8 && <div className="more-responses">目前顯示最新 8 則回答</div>}</div> : <div className="bar-list">{q.options.map((option) => { const value = stat.counts?.[option.id] ?? 0; const percent = (survey.responseCount ?? 0) ? Math.round(value / (survey.responseCount ?? 1) * 100) : 0; return <div className="bar-row" key={option.id}><div className="bar-label"><span>{option.text}</span><strong>{value}<small> 票 · {percent}%</small></strong></div><div className="bar-track"><span style={{ width: `${percent}%` }} /></div></div> })}</div>}
        </article>
      })}</div>}
    </section>
  </main>
}

function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) }

export default App
