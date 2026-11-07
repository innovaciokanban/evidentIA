import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api'
import { EmptyState } from '../ui/EmptyState'
import { LoadingState } from '../ui/LoadingState'
import type { Company, User } from '../../types'
import { learningApi } from '../../learning/learning-api'
import type { LearningAssignableUser, LearningCourse, LearningCourseInput, LearningCourseStatus, LearningEnrollment, LearningLesson, LearningLessonInput, LearningLessonType, LearningModule, LearningModuleInput } from '../../learning/learning-types'
import './LearningPage.css'

const statusLabels: Record<LearningCourseStatus, string> = { DRAFT: 'Borrador', PUBLISHED: 'Publicado', ARCHIVED: 'Archivado' }
const lessonTypeLabels: Record<LearningLessonType, string> = { TEXT: 'Lectura', VIDEO: 'Video', AUDIO: 'Audio', DOCUMENT: 'Documento', IMAGE: 'Imagen' }
const emptyCourse: LearningCourseInput = { title: '', description: '', category: '' }
const emptyModule: LearningModuleInput = { title: '', description: '' }
const emptyLesson: LearningLessonInput = { title: '', description: '', type: 'TEXT', content: '', durationMinutes: null }

const courseSummary = (course: LearningCourse): { modules: number; lessons: number; version: LearningCourse['versions'][number] | null } => {
  const version = course.versions.find((item) => item.status === 'PUBLISHED') ?? course.versions[0] ?? null
  return { modules: version?.modules.length ?? 0, lessons: version?.modules.reduce((count, module) => count + module.lessons.length, 0) ?? 0, version }
}

const errorMessage = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback

export function LearningPage({ user }: { user: User }) {
  const canManage = user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN'
  const isStudent = user.role === 'COMPANY_USER'
  const [courses, setCourses] = useState<LearningCourse[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [selected, setSelected] = useState<LearningCourse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState<LearningCourseStatus | ''>('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<LearningCourse | null>(null)

  const loadCourses = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await learningApi.listCourses()
      setCourses(result.courses)
    } catch (error) {
      setLoadError(errorMessage(error, 'No pudimos cargar el catálogo de aprendizaje.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCourses() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadCourses])

  useEffect(() => {
    if (!canManage || user.role !== 'SUPERUSER') return
    void api<{ companies: Company[] }>('/companies')
      .then((result) => setCompanies(result.companies))
      .catch(() => setCompanies([]))
  }, [canManage, user.role])

  const categories = Array.from(new Set(courses.map((course) => course.category))).sort((a, b) => a.localeCompare(b))
  const visibleCourses = courses.filter((course) => {
    const term = search.trim().toLocaleLowerCase()
    const matchesSearch = !term || `${course.title} ${course.description} ${course.company.name}`.toLocaleLowerCase().includes(term)
    return matchesSearch && (!category || course.category === category) && (!status || course.status === status)
  })
  const draftCount = courses.filter((course) => course.status === 'DRAFT').length
  const lessonCount = courses.reduce((total, course) => total + courseSummary(course).lessons, 0)

  async function openCourse(courseId: string) {
    setActionError('')
    try {
      const result = await learningApi.getCourse(courseId)
      setSelected(result.course)
    } catch (error) {
      setActionError(errorMessage(error, 'No pudimos abrir el curso.'))
    }
  }

  async function refreshSelected(courseId: string) {
    const result = await learningApi.getCourse(courseId)
    setSelected(result.course)
    setCourses((current) => current.map((course) => course.id === courseId ? result.course : course))
  }

  async function saveCourse(input: LearningCourseInput) {
    try {
      const result = editing
        ? await learningApi.updateCourse(editing.id, input)
        : await learningApi.createCourse(input)
      setCourses((current) => editing ? current.map((course) => course.id === result.course.id ? result.course : course) : [result.course, ...current])
      setFormOpen(false)
      setEditing(null)
      setSelected(result.course)
    } catch (error) {
      throw new Error(errorMessage(error, 'No se pudo guardar el curso.'), { cause: error })
    }
  }

  return (
    <div className="page learning-page">
      <header className="learning-header">
        <div>
          <p className="eyebrow">FORMACIÓN CORPORATIVA</p>
          <h1>{canManage ? 'Centro de aprendizaje' : 'Mi espacio de aprendizaje'}</h1>
          <p className="muted">{canManage ? 'Administra cursos y estructura contenidos para tu empresa.' : 'Consulta los cursos publicados disponibles para tu empresa.'}</p>
        </div>
        {canManage && <button className="button primary" onClick={() => { setEditing(null); setFormOpen(true) }}>+ Crear curso</button>}
      </header>

      <section className={`learning-stat-strip ${isStudent ? 'student-stats' : ''}`} aria-label="Indicadores de aprendizaje">
        <div><strong>{isStudent ? courses.length : courses.length}</strong><span>{isStudent ? 'Mis cursos' : 'Cursos en catálogo'}</span></div>
        <div><strong>{lessonCount}</strong><span>Lecciones estructuradas</span></div>
        <div><strong>{Array.from(new Set(courses.map((course) => course.category))).length}</strong><span>Categorías activas</span></div>
        {canManage && <div><strong>{draftCount}</strong><span>Borradores por preparar</span></div>}
      </section>

      {isStudent && <div className="learning-scope-note"><span className="learning-note-icon">i</span><span>Solo aparecen cursos asignados directamente a tu usuario. Cada inscripción conserva la versión publicada con la que fue creada.</span></div>}

      {selected ? (
        <>
          <LearningCourseDetail
            course={selected}
            canManage={canManage}
            onBack={() => setSelected(null)}
            onRefresh={() => refreshSelected(selected.id)}
            onEdit={() => { setEditing(selected); setFormOpen(true) }}
          />
          {canManage && <LearningEnrollmentPanel course={selected} />}
        </>
      ) : (
        <>
          <div className="learning-section-heading">
            <div><span className="learning-section-mark">01</span><div><h2>{canManage ? 'Catálogo de formación' : 'Mis cursos'}</h2><p>{canManage ? 'Crea, versiona, publica y asigna rutas de aprendizaje.' : 'Continúa con los cursos que te han asignado.'}</p></div></div>
            {canManage && <button className="button secondary" onClick={() => { setEditing(null); setFormOpen(true) }}>+ Nuevo curso</button>}
          </div>
          <div className="learning-filters">
            <label className="learning-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cursos..." aria-label="Buscar cursos" /></label>
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por categoría"><option value="">Todas las categorías</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
            {canManage && <select value={status} onChange={(event) => setStatus(event.target.value as LearningCourseStatus | '')} aria-label="Filtrar por estado"><option value="">Todos los estados</option><option value="DRAFT">Borradores</option><option value="PUBLISHED">Publicados</option><option value="ARCHIVED">Archivados</option></select>}
          </div>
          {loadError ? <div className="form-error learning-alert"><span>{loadError}</span><button className="text-button" onClick={() => void loadCourses()}>Reintentar</button></div> : loading ? <LoadingState text="Preparando el catálogo..." /> : visibleCourses.length === 0 ? <EmptyState icon="✦" title={courses.length === 0 ? (isStudent ? 'Aún no tienes cursos asignados' : 'El catálogo está listo para comenzar') : 'No hay cursos que coincidan'} text={courses.length === 0 ? (canManage ? 'Crea el primer curso para empezar a organizar la formación.' : 'Cuando te asignen un curso aparecerá aquí.') : 'Prueba con otra búsqueda o cambia los filtros.'} action={canManage && courses.length === 0 ? <button className="button primary" onClick={() => { setEditing(null); setFormOpen(true) }}>Crear primer curso</button> : undefined} /> : <div className="learning-course-grid">{visibleCourses.map((course, index) => <LearningCourseCard key={course.id} course={course} index={index} canManage={canManage} onOpen={() => void openCourse(course.id)} />)}</div>}
        </>
      )}

      <section className="learning-resources" aria-labelledby="learning-resources-title">
        <div className="learning-section-heading compact">
          <div><span className="learning-section-mark">02</span><div><h2 id="learning-resources-title">Podcasts y recursos</h2><p>El espacio está preparado para ampliar el catálogo de formatos.</p></div></div>
        </div>
        <article className="learning-resource-placeholder">
          <div className="learning-resource-cover" aria-hidden="true"><span>♪</span></div>
          <div><span className="learning-category">PODCASTS</span><h3>Contenido de audio</h3><p>No hay podcasts ni biblioteca de recursos conectados al servicio actual.</p></div>
          <span className="learning-status pending">Pendiente</span>
        </article>
      </section>

      {actionError && <div className="learning-toast" role="alert">{actionError}<button onClick={() => setActionError('')} aria-label="Cerrar aviso">×</button></div>}
      {formOpen && <CourseForm editing={editing} companies={companies} isSuperuser={user.role === 'SUPERUSER'} defaultCompanyId={user.companyId ?? ''} onClose={() => { setFormOpen(false); setEditing(null) }} onSave={saveCourse} />}
    </div>
  )
}

export function LearningCourseCard({ course, index, canManage, onOpen }: { course: LearningCourse; index: number; canManage: boolean; onOpen: () => void }) {
  const summary = courseSummary(course)
  return (
    <button className={`learning-course-card palette-${index % 4}`} onClick={onOpen}>
      <div className="learning-card-top"><span className="learning-card-index">{String(index + 1).padStart(2, '0')}</span><span className={`learning-status ${course.status.toLowerCase()}`}>{statusLabels[course.status]}</span></div>
      <div className="learning-card-illustration" aria-hidden="true"><span>{course.category.slice(0, 1).toUpperCase()}</span><i /><b>Ruta</b></div>
      <div className="learning-card-content"><span className="learning-category">{course.category}</span><h3>{course.title}</h3><p>{course.description}</p></div>
      <div className="learning-card-footer"><span>{summary.modules} módulos</span><span>{summary.lessons} lecciones</span><span className="learning-card-arrow">Ver contenido&nbsp; ↗</span></div>
      {!canManage && course.enrollment && <div className="learning-card-audience"><span />Inscrito · versión asignada</div>}
    </button>
  )
}

function LearningEnrollmentPanel({ course }: { course: LearningCourse }) {
  const [users, setUsers] = useState<LearningAssignableUser[]>([])
  const [enrollments, setEnrollments] = useState<LearningEnrollment[]>([])
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [allCurrentCompanyUsers, setAllCurrentCompanyUsers] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [userResult, enrollmentResult] = await Promise.all([
        learningApi.listAssignableUsers(course.id),
        learningApi.listEnrollments(course.id),
      ])
      setUsers(userResult.users)
      setEnrollments(enrollmentResult.enrollments)
    } catch (requestError) {
      setError(errorMessage(requestError, 'No pudimos cargar las inscripciones.'))
    } finally {
      setLoading(false)
    }
  }, [course.id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (course.status === 'PUBLISHED') void load()
      else setLoading(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [course.status, load])

  const filteredUsers = users.filter((user) => {
    const term = search.trim().toLocaleLowerCase()
    return !term || `${user.name} ${user.email}`.toLocaleLowerCase().includes(term)
  })

  function toggleUser(userId: string) {
    setSelectedIds((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId])
  }

  async function assignUsers(event: FormEvent) {
    event.preventDefault()
    if (!allCurrentCompanyUsers && selectedIds.length === 0) {
      setError('Selecciona al menos un usuario o elige toda la empresa.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await learningApi.enrollUsers(course.id, allCurrentCompanyUsers ? { allCurrentCompanyUsers: true } : { userIds: selectedIds })
      setEnrollments(result.enrollments)
      setUsers((current) => current.map((user) => result.enrollments.some((enrollment) => enrollment.userId === user.id) ? { ...user, enrolled: true } : user))
      setSelectedIds([])
      setAllCurrentCompanyUsers(false)
      setNotice(`${result.created} inscripción${result.created === 1 ? '' : 'es'} creada${result.created === 1 ? '' : 's'}${result.alreadyEnrolled ? ` · ${result.alreadyEnrolled} ya existía${result.alreadyEnrolled === 1 ? '' : 'n'}` : ''}.`)
    } catch (requestError) {
      setError(errorMessage(requestError, 'No se pudieron crear las inscripciones.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="learning-enrollment-panel" aria-labelledby="learning-enrollment-title">
      <div className="learning-section-heading compact">
        <div><span className="learning-section-mark">03</span><div><h2 id="learning-enrollment-title">Inscripciones</h2><p>Asigna la versión publicada a usuarios actuales de {course.company.name}.</p></div></div>
      </div>
      {course.status !== 'PUBLISHED' ? <div className="learning-enrollment-empty">Publica el curso para habilitar sus inscripciones.</div> : loading ? <LoadingState text="Cargando usuarios inscritos..." /> : (
        <div className="learning-enrollment-layout">
          <form className="learning-enrollment-form" onSubmit={assignUsers}>
            <div className="learning-enrollment-form-header"><strong>Asignar usuarios</strong><span>{users.filter((user) => !user.enrolled).length} disponibles</span></div>
            <label className="learning-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o correo" aria-label="Buscar usuarios para inscribir" /></label>
            <label className="learning-enrollment-all"><input type="checkbox" checked={allCurrentCompanyUsers} onChange={(event) => { setAllCurrentCompanyUsers(event.target.checked); setSelectedIds([]) }} />Asignar a todos los usuarios activos actuales</label>
            {!allCurrentCompanyUsers && <div className="learning-user-picker">{filteredUsers.length === 0 ? <p className="learning-picker-empty">No hay usuarios que coincidan con la búsqueda.</p> : filteredUsers.map((user) => <label className={`learning-user-option ${user.enrolled ? 'enrolled' : ''}`} key={user.id}><input type="checkbox" checked={user.enrolled || selectedIds.includes(user.id)} disabled={user.enrolled} onChange={() => toggleUser(user.id)} /><span><strong>{user.name}</strong><small>{user.email}</small></span><em>{user.enrolled ? 'Inscrito' : user.role === 'COMPANY_ADMIN' ? 'Admin. empresa' : 'Usuario'}</em></label>)}</div>}
            {error && <div className="form-error" role="alert">{error}</div>}
            {notice && <div className="form-success" role="status">{notice}</div>}
            <button className="button primary" disabled={saving}>{saving ? 'Asignando...' : allCurrentCompanyUsers ? 'Asignar a toda la empresa' : `Asignar seleccionados${selectedIds.length ? ` (${selectedIds.length})` : ''}`}</button>
          </form>
          <div className="learning-enrolled-list"><div className="learning-enrollment-form-header"><strong>Usuarios inscritos</strong><span>{enrollments.length}</span></div>{enrollments.length === 0 ? <p className="learning-picker-empty">Todavía no hay usuarios inscritos en este curso.</p> : <div className="learning-enrolled-items">{enrollments.map((enrollment) => <div className="learning-enrolled-item" key={enrollment.id}><span className="avatar tiny">{enrollment.user.name.slice(0, 1).toUpperCase()}</span><span><strong>{enrollment.user.name}</strong><small>{enrollment.user.email}</small></span></div>)}</div>}</div>
        </div>
      )}
      {course.status === 'PUBLISHED' && !loading && <button className="text-button learning-reload-enrollments" onClick={() => void load()}>Actualizar usuarios</button>}
    </section>
  )
}

function CourseForm({ editing, companies, isSuperuser, defaultCompanyId, onClose, onSave }: { editing: LearningCourse | null; companies: Company[]; isSuperuser: boolean; defaultCompanyId: string; onClose: () => void; onSave: (input: LearningCourseInput) => Promise<void> }) {
  const [draft, setDraft] = useState<LearningCourseInput>(editing ? { title: editing.title, description: editing.description, category: editing.category } : { ...emptyCourse, companyId: isSuperuser ? '' : defaultCompanyId })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('')
    try { await onSave(draft) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar el curso.') } finally { setSaving(false) }
  }
  return <div className="drawer-backdrop"><form className="drawer learning-drawer" onSubmit={submit}><div className="drawer-heading"><div><span className="learning-kicker">{editing ? 'Editar curso' : 'Nuevo curso'}</span><h2>{editing ? 'Ajusta la ruta de aprendizaje' : 'Crea una ruta de aprendizaje'}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">×</button></div>{error && <div className="form-error">{error}</div>}<label>Nombre del curso<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Ej. Cultura de servicio" minLength={1} maxLength={160} required /></label><label>Descripción<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Explica qué aprenderá la persona al terminar." rows={5} maxLength={5000} required /></label><label>Categoría<input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="Ej. Inducción" maxLength={80} required /></label>{isSuperuser && !editing && <label>Empresa<select value={draft.companyId ?? ''} onChange={(event) => setDraft({ ...draft, companyId: event.target.value })} required><option value="">Selecciona una empresa</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}<div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear curso'}</button></div></form></div>
}

function LearningCourseDetail({ course, canManage, onBack, onRefresh, onEdit }: { course: LearningCourse; canManage: boolean; onBack: () => void; onRefresh: () => Promise<void>; onEdit: () => void }) {
  const [versionId, setVersionId] = useState(course.versions.find((version) => version.status === 'DRAFT')?.id ?? course.versions[0]?.id ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [moduleDraft, setModuleDraft] = useState<LearningModuleInput>(emptyModule)
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null)
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, LearningLessonInput>>({})
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null)
  const [lessonEdit, setLessonEdit] = useState<LearningLessonInput>(emptyLesson)
  const version = course.versions.find((item) => item.id === versionId) ?? course.versions[0]
  const editable = canManage && version?.status === 'DRAFT'

  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action(); await onRefresh() } catch (actionError) { setError(errorMessage(actionError, 'No se pudo actualizar el curso.')) } finally { setBusy(false) }
  }
  async function addModule(event: FormEvent) { event.preventDefault(); await perform(async () => { await learningApi.createModule(version!.id, moduleDraft); setModuleDraft(emptyModule) }) }
  async function addLesson(event: FormEvent, moduleId: string) { event.preventDefault(); const draft = lessonDrafts[moduleId] ?? emptyLesson; await perform(async () => { await learningApi.createLesson(moduleId, draft); setLessonDrafts((current) => ({ ...current, [moduleId]: emptyLesson })) }) }
  async function moveModule(module: LearningModule, direction: -1 | 1) { if (!version) return; const ordered = [...version.modules].sort((a, b) => a.position - b.position); const index = ordered.findIndex((item) => item.id === module.id); const target = index + direction; if (target < 0 || target >= ordered.length) return; [ordered[index], ordered[target]] = [ordered[target], ordered[index]]; await perform(() => learningApi.reorderModules(version.id, ordered.map((item) => item.id))) }
  async function moveLesson(module: LearningModule, lesson: LearningLesson, direction: -1 | 1) { const ordered = [...module.lessons].sort((a, b) => a.position - b.position); const index = ordered.findIndex((item) => item.id === lesson.id); const target = index + direction; if (target < 0 || target >= ordered.length) return; [ordered[index], ordered[target]] = [ordered[target], ordered[index]]; await perform(() => learningApi.reorderLessons(module.id, ordered.map((item) => item.id))) }
  const totalLessons = version?.modules.reduce((total, module) => total + module.lessons.length, 0) ?? 0
  return <div className="learning-detail"><button className="learning-back" onClick={onBack}>← Volver al catálogo</button><header className={`learning-detail-hero palette-${course.title.length % 4}`}><div><span className="learning-category">{course.category}</span><h1>{course.title}</h1><p>{course.description}</p><div className="learning-detail-meta"><span className={`learning-status ${course.status.toLowerCase()}`}>{statusLabels[course.status]}</span><span>{version?.modules.length ?? 0} módulos</span><span>{totalLessons} lecciones</span>{version && <span>Versión {version.versionNumber}</span>}</div></div><div className="learning-detail-emblem" aria-hidden="true"><span>IA</span><small>learning path</small></div></header>{error && <div className="form-error learning-alert">{error}</div>}<div className="learning-detail-toolbar">{canManage && <><button className="button secondary" onClick={onEdit}>Editar curso</button><button className="button secondary" disabled={busy} onClick={() => void perform(() => learningApi.createVersion(course.id, 'Nueva versión de contenidos'))}>+ Nueva versión</button>{course.status !== 'ARCHIVED' ? <button className="button danger" disabled={busy} onClick={() => void perform(() => learningApi.archiveCourse(course.id))}>Archivar</button> : null}</>}{canManage && course.versions.length > 0 && <select value={version?.id ?? ''} onChange={(event) => setVersionId(event.target.value)} aria-label="Seleccionar versión">{course.versions.map((item) => <option key={item.id} value={item.id}>Versión {item.versionNumber} · {statusLabels[item.status]}</option>)}</select>}{editable && <button className="button primary" disabled={busy} onClick={() => void perform(() => learningApi.publishCourse(course.id, version.id))}>Publicar versión</button>}</div><div className="learning-detail-layout"><section className="learning-curriculum"><div className="learning-section-heading compact"><div><span className="learning-section-mark">02</span><div><h2>Ruta del curso</h2><p>{editable ? 'Ordena el contenido y prepara la publicación.' : 'Contenido organizado para avanzar con claridad.'}</p></div></div></div>{version?.modules.length ? <div className="learning-module-list">{version.modules.slice().sort((a, b) => a.position - b.position).map((module, moduleIndex) => <ModuleCard key={module.id} module={module} moduleIndex={moduleIndex} editable={editable} editingModuleId={editingModuleId} setEditingModuleId={setEditingModuleId} onUpdate={(input) => perform(() => learningApi.updateModule(module.id, input))} onDelete={() => perform(() => learningApi.deleteModule(module.id))} onMove={(direction) => moveModule(module, direction)} lessonDraft={lessonDrafts[module.id] ?? emptyLesson} onLessonDraftChange={(draft) => setLessonDrafts((current) => ({ ...current, [module.id]: draft }))} onAddLesson={(event) => void addLesson(event, module.id)} editingLessonId={editingLessonId} setEditingLessonId={setEditingLessonId} lessonEdit={lessonEdit} setLessonEdit={setLessonEdit} onUpdateLesson={(lessonId, input) => perform(() => learningApi.updateLesson(lessonId, input))} onDeleteLesson={(lessonId) => perform(() => learningApi.deleteLesson(lessonId))} onMoveLesson={(lesson, direction) => moveLesson(module, lesson, direction)} />)}</div> : <EmptyState compact icon="01" title="Aún no hay módulos" text={editable ? 'Crea el primer módulo para darle forma a este curso.' : 'Esta versión todavía no tiene contenido estructurado.'} />} {editable && <form className="learning-inline-form" onSubmit={addModule}><div><span className="learning-form-label">Nuevo módulo</span><input value={moduleDraft.title} onChange={(event) => setModuleDraft({ ...moduleDraft, title: event.target.value })} placeholder="Nombre del módulo" required /><input value={moduleDraft.description} onChange={(event) => setModuleDraft({ ...moduleDraft, description: event.target.value })} placeholder="Descripción breve (opcional)" /></div><button className="button primary" disabled={busy}>Añadir módulo</button></form>}</section><aside className="learning-detail-aside"><div className="learning-aside-card"><span className="learning-aside-icon">✦</span><span className="learning-form-label">Estado de publicación</span><strong>{statusLabels[course.status]}</strong><p>{course.status === 'PUBLISHED' ? 'Esta ruta está disponible para las personas autorizadas de la empresa.' : 'Solo los administradores pueden ver y preparar esta versión.'}</p></div><div className="learning-aside-card learning-aside-pale"><span className="learning-form-label">Última actualización</span><strong>{new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(course.updatedAt))}</strong><p>Actualizado por {course.updatedBy.name}.</p></div></aside></div></div>
}

function ModuleCard({ module, moduleIndex, editable, editingModuleId, setEditingModuleId, onUpdate, onDelete, onMove, lessonDraft, onLessonDraftChange, onAddLesson, editingLessonId, setEditingLessonId, lessonEdit, setLessonEdit, onUpdateLesson, onDeleteLesson, onMoveLesson }: { module: LearningModule; moduleIndex: number; editable: boolean; editingModuleId: string | null; setEditingModuleId: (id: string | null) => void; onUpdate: (input: Partial<LearningModuleInput>) => Promise<void>; onDelete: () => Promise<void>; onMove: (direction: -1 | 1) => Promise<void>; lessonDraft: LearningLessonInput; onLessonDraftChange: (draft: LearningLessonInput) => void; onAddLesson: (event: FormEvent) => void; editingLessonId: string | null; setEditingLessonId: (id: string | null) => void; lessonEdit: LearningLessonInput; setLessonEdit: (draft: LearningLessonInput) => void; onUpdateLesson: (id: string, input: Partial<LearningLessonInput>) => Promise<void>; onDeleteLesson: (id: string) => Promise<void>; onMoveLesson: (lesson: LearningLesson, direction: -1 | 1) => Promise<void> }) {
  const [draft, setDraft] = useState({ title: module.title, description: module.description })
  const [saving, setSaving] = useState(false)
  async function save(event: FormEvent) { event.preventDefault(); setSaving(true); try { await onUpdate(draft); setEditingModuleId(null) } finally { setSaving(false) } }
  return <article className="learning-module-card"><div className="learning-module-heading"><div className="learning-module-number">{String(moduleIndex + 1).padStart(2, '0')}</div><div className="learning-module-title"><span className="learning-form-label">Módulo</span>{editingModuleId === module.id ? <form onSubmit={save} className="learning-edit-form"><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><div><button type="button" className="text-button" onClick={() => setEditingModuleId(null)}>Cancelar</button><button className="text-button">{saving ? 'Guardando...' : 'Guardar'}</button></div></form> : <><h3>{module.title}</h3><p>{module.description || 'Contenido del módulo'}</p></>}</div>{editable && <div className="learning-module-actions"><button className="row-action" title="Subir módulo" onClick={() => void onMove(-1)}>↑</button><button className="row-action" title="Bajar módulo" onClick={() => void onMove(1)}>↓</button><button className="text-button" onClick={() => setEditingModuleId(module.id)}>Editar</button><button className="text-button danger" onClick={() => void onDelete()}>Eliminar</button></div>}</div><div className="learning-lesson-list">{module.lessons.slice().sort((a, b) => a.position - b.position).map((lesson, lessonIndex) => <div className="learning-lesson-row" key={lesson.id}><span className="learning-lesson-number">{lessonIndex + 1}</span><span className="learning-lesson-type">{lessonTypeLabels[lesson.type]}</span>{editingLessonId === lesson.id ? <form className="learning-edit-lesson" onSubmit={async (event) => { event.preventDefault(); await onUpdateLesson(lesson.id, lessonEdit); setEditingLessonId(null) }}><input value={lessonEdit.title} onChange={(event) => setLessonEdit({ ...lessonEdit, title: event.target.value })} required /><select value={lessonEdit.type} onChange={(event) => setLessonEdit({ ...lessonEdit, type: event.target.value as LearningLessonType })}>{Object.entries(lessonTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><div><button type="button" className="text-button" onClick={() => setEditingLessonId(null)}>Cancelar</button><button className="text-button">Guardar</button></div></form> : <><div className="learning-lesson-copy"><strong>{lesson.title}</strong><small>{lesson.description || 'Sin descripción'}{lesson.durationMinutes ? ` · ${lesson.durationMinutes} min` : ''}</small></div>{editable && <div className="learning-lesson-actions"><button className="row-action" onClick={() => void onMoveLesson(lesson, -1)} title="Subir lección">↑</button><button className="row-action" onClick={() => void onMoveLesson(lesson, 1)} title="Bajar lección">↓</button><button className="text-button" onClick={() => { setEditingLessonId(lesson.id); setLessonEdit({ title: lesson.title, description: lesson.description, type: lesson.type, content: lesson.content, durationMinutes: lesson.durationMinutes }) }}>Editar</button><button className="text-button danger" onClick={() => void onDeleteLesson(lesson.id)}>Eliminar</button></div>}</>}</div>)}{editable && <form className="learning-add-lesson" onSubmit={onAddLesson}><input value={lessonDraft.title} onChange={(event) => onLessonDraftChange({ ...lessonDraft, title: event.target.value })} placeholder="Nueva lección" required /><select value={lessonDraft.type} onChange={(event) => onLessonDraftChange({ ...lessonDraft, type: event.target.value as LearningLessonType })}>{Object.entries(lessonTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="text-button">+ Añadir</button></form>}</div></article>
}
