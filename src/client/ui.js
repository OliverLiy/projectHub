/** 面板基础组件：图标、按钮、徽标、进度、弹窗、抽屉、提示。 */
import React from 'react'
import { RISK_META, clampProgress } from '../shared/analysis.js'
const h = React.createElement
const { useEffect, useRef, useState } = React

/* ------------------------------------------------------------------ 图标 */

const PATHS = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M4 6h16M4 12h16M4 18h16',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 3l9 16H3zM12 9v5M12 17h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  check: 'M4 12l5 5L20 6',
  users: 'M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 6.5a3 3 0 1 0 0 5 3 3 0 0 0 0-5zM21 20v-2a4 4 0 0 0-3-3.9',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  calendar: 'M4 6h16v14H4zM8 3v4M16 3v4M4 10h16',
  sparkle: 'M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  chevron: 'M9 6l6 6-6 6',
  arrowLeft: 'M15 6l-6 6 6 6',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 14h10l1-14M10 11v6M14 11v6',
  edit: 'M4 20h4l11-11-4-4L4 16zM14 5l4 4',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  download: 'M12 4v11M7 12l5 5 5-5M5 20h14',
  note: 'M6 3h9l5 5v13H6zM15 3v5h5M9 13h6M9 17h4',
  filter: 'M4 5h16l-6 7v7l-4-2v-5z',
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12h.01'
}

export function Icon({ name, size = 16, className = 'pc-icon', strokeWidth = 1.7 }) {
  const path = PATHS[name] ?? PATHS.grid
  return h('svg', {
    className, width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true', focusable: 'false'
  }, h('path', { d: path }))
}

/* ---------------------------------------------------------------- 按钮 */

export function Btn({ children, onClick, variant = 'ghost', size = '', icon, disabled = false, title, type = 'button' }) {
  return h('button', {
    type,
    className: `pc-btn${variant === 'ghost' ? '' : ` pc-btn-${variant}`}${size ? ` pc-btn-${size}` : ''}`,
    onClick,
    disabled,
    title: title || undefined
  }, icon ? h(Icon, { name: icon, size: size === 'sm' ? 13 : 15 }) : null, children)
}

export function IconBtn({ icon, title, onClick, disabled = false, variant = '', size = '' }) {
  return h('button', {
    type: 'button',
    className: `pc-iconbtn${variant ? ` pc-iconbtn-${variant}` : ''}${size ? ` pc-iconbtn-${size}` : ''}`,
    onClick,
    disabled,
    title,
    'aria-label': title
  }, h(Icon, { name: icon, size: size === 'sm' ? 14 : 16 }))
}

export function Segmented({ value, options, onChange, ariaLabel }) {
  return h('div', { className: 'pc-seg', role: 'group', 'aria-label': ariaLabel },
    options.map((option) => h('button', {
      key: option.value,
      type: 'button',
      'aria-pressed': value === option.value,
      onClick: () => onChange(option.value),
      title: option.title || undefined
    }, option.icon ? h(Icon, { name: option.icon, size: 14 }) : null, option.label)))
}

/* ---------------------------------------------------------------- 展示 */

export function Badge({ children, tone = 'muted', dot = false }) {
  return h('span', { className: `pc-badge pc-tone-${tone}` }, dot ? h('i') : null, children)
}

export function RiskBadge({ risk, showDot = true }) {
  const meta = risk || RISK_META.normal
  return h('span', { className: `pc-badge pc-tone-${meta.tone}`, title: meta.detail || meta.label },
    showDot ? h('i') : null, meta.label)
}

export function Progress({ value, tone = '' }) {
  const percent = clampProgress({ progress: value })
  return h('div', {
    className: `pc-progress${tone ? ` pc-progress-${tone}` : ''}`,
    role: 'progressbar', 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100,
    'aria-label': `进度 ${percent}%`
  }, h('i', { style: { width: `${percent}%` } }))
}

export function Stat({ label, value, hint, tone = '', icon }) {
  return h('div', { className: `pc-kpi${tone ? ` pc-kpi-${tone}` : ''}` },
    h('div', { className: 'pc-kpi-top' }, icon ? h(Icon, { name: icon, size: 13 }) : null, label),
    h('div', { className: 'pc-kpi-value' }, String(value)),
    hint ? h('div', { className: 'pc-kpi-foot' }, hint) : null)
}

export function Empty({ icon = 'inbox', title, hint, action }) {
  return h('div', { className: 'pc-empty' },
    h('div', { className: 'pc-empty-icon' }, h(Icon, { name: icon, size: 18 })),
    h('div', { className: 'pc-empty-title' }, title),
    hint ? h('div', { className: 'pc-muted' }, hint) : null,
    action || null)
}

export function Notice({ children, tone = 'warn', action }) {
  return h('div', { className: `pc-notice${tone === 'danger' ? ' pc-notice-danger' : ''}`, role: 'status' },
    h(Icon, { name: tone === 'danger' ? 'alert' : 'clock', size: 15 }),
    h('div', { className: 'pc-notice-body' }, h('div', null, children), action || null))
}

export function Field({ label, hint, span = false, children }) {
  return h('label', { className: `pc-field${span ? ' pc-field-span' : ''}` },
    h('span', null, label), children, hint ? h('small', null, hint) : null)
}

/* ------------------------------------------------------- 弹窗 / 抽屉 / 提示 */

function useEscape(active, onEscape) {
  useEffect(() => {
    if (!active) return undefined
    const handler = (event) => { if (event.key === 'Escape') onEscape() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onEscape])
}

export function Modal({ open, title, icon = 'plus', children, footer, onClose, labelledBy = 'pc-modal-title' }) {
  useEscape(open, onClose)
  const bodyRef = useRef(null)
  useEffect(() => {
    if (!open || !bodyRef.current) return
    const focusable = bodyRef.current.querySelector('input, select, textarea, button')
    if (focusable) focusable.focus()
  }, [open])
  if (!open) return null
  return h(React.Fragment, null,
    h('div', { className: 'pc-scrim', onClick: onClose, 'aria-hidden': 'true' }),
    h('div', { className: 'pc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy },
      h('div', { className: 'pc-modal-head' },
        h(Icon, { name: icon, size: 17 }),
        h('h2', { id: labelledBy }, title),
        h(IconBtn, { icon: 'close', title: '关闭', onClick: onClose })),
      h('div', { className: 'pc-modal-body', ref: bodyRef }, children),
      footer ? h('div', { className: 'pc-modal-foot' }, footer) : null))
}

export function Sheet({ open, title, icon = 'note', badge, actions, children, footer, onClose }) {
  useEscape(open, onClose)
  if (!open) return null
  return h(React.Fragment, null,
    h('div', { className: 'pc-scrim', onClick: onClose, 'aria-hidden': 'true' }),
    h('div', { className: 'pc-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { className: 'pc-sheet-head' },
        h('div', { className: 'pc-sheet-title' },
          h('h2', null, title),
          h('div', { className: 'pc-chips' }, badge)),
        h('div', { className: 'pc-chips' }, actions),
        h(IconBtn, { icon: 'close', title: '关闭详情', onClick: onClose })),
      h('div', { className: 'pc-sheet-body' }, children),
      footer ? h('div', { className: 'pc-sheet-foot' }, footer) : null))
}

export function Toast({ message, tone = '', onDone, duration = 2600 }) {
  useEffect(() => {
    if (!message) return undefined
    const timer = setTimeout(onDone, duration)
    return () => clearTimeout(timer)
  }, [message, duration, onDone])
  if (!message) return null
  return h('div', { className: `pc-toast${tone === 'danger' ? ' pc-toast-danger' : ''}`, role: 'status', 'aria-live': 'polite' },
    h(Icon, { name: tone === 'danger' ? 'alert' : 'check', size: 14 }), message)
}

/** 受控的搜索输入。 */
export function SearchBox({ value, onChange, placeholder, label }) {
  return h('div', { className: 'pc-search' },
    h(Icon, { name: 'search', size: 15 }),
    h('input', {
      value,
      placeholder,
      'aria-label': label || placeholder,
      onChange: (event) => onChange(event.target.value)
    }),
    value ? h('button', { type: 'button', className: 'pc-search-clear', 'aria-label': '清空搜索', onClick: () => onChange('') },
      h(Icon, { name: 'close', size: 12 })) : null)
}

/** 简单的挂载后自动消失的提示状态。 */
export function useToast() {
  const [toast, setToast] = useState(null)
  return {
    toast,
    show(message, tone = '') { setToast({ message, tone }) },
    clear() { setToast(null) }
  }
}
