/** 手写的轻量图表：不引第三方库，全部用 SVG / CSS 变量，跟着宿主主题走。 */
import React from 'react'

const h = React.createElement

const toneClass = (tone) => `pc-c-${tone || 'muted'}`

/**
 * 环形图。
 * @param slices - [{ key, count, tone }]
 * @param centerValue / centerLabel - 圆心文字。
 */
export function Donut({ slices, centerValue, centerLabel, size = 136, thickness = 15, label = '分布' }) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return h('div', { className: 'pc-donut', style: { width: `${size}px`, height: `${size}px` } },
    h('svg', {
      width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img',
      'aria-label': `${label}：${slices.map((slice) => `${slice.label ?? slice.key} ${slice.count}`).join('，') || '无数据'}`
    },
    h('circle', {
      cx: size / 2, cy: size / 2, r: radius, fill: 'none',
      className: 'pc-donut-track', strokeWidth: thickness
    }),
    total > 0
      ? slices.map((slice) => {
        const length = (slice.count / total) * circumference
        const gap = circumference - length
        const node = h('circle', {
          key: slice.key,
          cx: size / 2, cy: size / 2, r: radius, fill: 'none',
          className: `pc-donut-slice ${toneClass(slice.tone)}`,
          strokeWidth: thickness,
          strokeDasharray: `${length} ${gap}`,
          strokeDashoffset: -offset,
          transform: `rotate(-90 ${size / 2} ${size / 2})`
        })
        offset += length
        return node
      })
      : null),
    h('div', { className: 'pc-donut-center' },
      h('b', null, String(centerValue ?? total)),
      h('span', null, centerLabel ?? '项目')))
}

/** 图例。 */
export function Legend({ items }) {
  return h('ul', { className: 'pc-legend' }, items.map((item) => h('li', { key: item.key },
    h('i', { className: toneClass(item.tone) }),
    h('span', null, item.label),
    h('b', null, String(item.count)))))
}

/**
 * 堆叠条形：一行一个维度，条内按构成分段。
 * @param rows - [{ key, label, meta, segments: [{ value, tone, label }], total }]
 */
export function StackedBars({ rows, max, empty = '暂无数据' }) {
  if (!rows || rows.length === 0) return h('div', { className: 'pc-muted' }, empty)
  const ceiling = max ?? Math.max(...rows.map((row) => row.total), 1)
  return h('div', { className: 'pc-stacked' }, rows.map((row) => h('div', { className: 'pc-stacked-row', key: row.key },
    h('div', { className: 'pc-stacked-head' },
      h('span', { className: 'pc-stacked-label', title: row.label }, row.label),
      h('span', { className: 'pc-stacked-meta' }, row.meta ?? String(row.total))),
    h('div', {
      className: 'pc-stacked-track',
      role: 'img',
      'aria-label': `${row.label}：${row.segments.map((segment) => `${segment.label} ${segment.value}`).join('，')}`
    },
    row.segments.filter((segment) => segment.value > 0).map((segment) => h('span', {
      key: segment.label,
      className: `pc-stacked-seg ${toneClass(segment.tone)}`,
      style: { width: `${(segment.value / ceiling) * 100}%` },
      title: `${segment.label} ${segment.value}`
    }))))))
}

/** 竖向直方图。 */
export function Histogram({ buckets }) {
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1)
  return h('div', { className: 'pc-hist' }, buckets.map((bucket) => h('div', { className: 'pc-hist-col', key: bucket.label },
    h('div', { className: 'pc-hist-track' },
      h('div', {
        className: `pc-hist-bar${bucket.count === 0 ? ' pc-hist-empty' : ''}`,
        style: { height: `${Math.max(3, (bucket.count / max) * 100)}%` },
        title: `${bucket.label}：${bucket.count} 个`
      })),
    h('b', null, String(bucket.count)),
    h('span', null, bucket.label))))
}

/** 单行排行条（负责人负载等）。 */
export function RankBars({ rows, empty = '暂无数据' }) {
  if (!rows || rows.length === 0) return h('div', { className: 'pc-muted' }, empty)
  const max = Math.max(...rows.map((row) => row.total), 1)
  return h('div', { className: 'pc-rank' }, rows.map((row) => h('div', { className: 'pc-rank-row', key: row.key },
    h('span', { className: 'pc-rank-label', title: row.label }, row.label),
    h('div', { className: 'pc-rank-track' },
      h('span', { className: 'pc-rank-fill', style: { width: `${(row.total / max) * 100}%` } }),
      row.danger > 0
        ? h('span', { className: 'pc-rank-danger', style: { width: `${(row.danger / max) * 100}%` }, title: `其中 ${row.danger} 个需关注` })
        : null),
    h('b', null, String(row.total)),
    h('small', null, row.meta ?? ''))))
}
