/**
 * 示例项目：一个后端/全栈工程师手上常见的工作，每种项目模块各 4 个。
 * 覆盖逾期、紧急、进度风险、阻塞、待启动与已完成，日期都相对"今天"计算，
 * 任何一天生成都成立。这些记录带 `示例` 标签，方便识别与清理。
 */
import { todayISO } from './analysis.js'
const pad = (value) => String(value).padStart(2, '0')

/** 相对今天偏移若干天的本地日历日。 */
function shift(today, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today))
  if (!match) return today
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 相对今天偏移若干天的 ISO 时间戳。 */
function stamp(today, days) {
  return `${shift(today, days)}T09:00:00.000Z`
}

const update = (id, today, days, kind, text) => ({ id, at: stamp(today, days), kind, text })
const todo = (id, title, owner, today, days, done = false) => ({
  id, title, owner, dueDate: shift(today, days), done, doneAt: done ? stamp(today, days) : ''
})

function make(today, spec) {
  return {
    id: spec.id,
    name: spec.name,
    module: spec.module,
    status: spec.status ?? '进行中',
    owner: spec.owner ?? '我',
    dueDate: shift(today, spec.due),
    startedOn: shift(today, spec.start),
    progress: spec.progress ?? 0,
    link: spec.link ?? '',
    summary: spec.summary ?? '',
    tags: ['示例', ...(spec.tags ?? [])],
    createdAt: stamp(today, spec.start),
    updatedAt: stamp(today, spec.last ?? -1),
    updates: spec.updates ?? [],
    todos: spec.todos ?? []
  }
}

/**
 * 生成示例项目：公司项目 4 个、日常工作 4 个、其他项目 4 个。
 * @param today - 本地日历日 YYYY-MM-DD，默认今天。
 */
export function buildSampleProjects(today = todayISO()) {
  const specs = [
    // ---------------------------------------------------------- 公司项目
    {
      id: 'demo-company-1', name: '订单结算服务重构', module: '公司项目', progress: 55, start: -30, due: -2, last: -2,
      summary: '把结算逻辑从单体拆成独立服务，接口按领域重划，历史数据要能对得上。', tags: ['后端', '重构'],
      updates: [
        update('demo-company-1-u1', today, -12, 'progress', '结算链路拆出独立服务，主干联调通过'),
        update('demo-company-1-u2', today, -4, 'blocker', '旧系统遗留的优惠券口径没确认，验收用例写不下去')
      ],
      todos: [
        todo('demo-company-1-t1', '补齐结算接口的契约测试', '我', today, -3),
        todo('demo-company-1-t2', '和财务确认历史订单的结算口径', '我', today, 1)
      ]
    },
    {
      id: 'demo-company-2', name: '数据中台订单域接入', module: '公司项目', progress: 40, start: -20, due: 2, last: -1,
      summary: '把订单库的增量变更实时打进数据中台，先跑通订单域的一张宽表。', tags: ['数据', 'CDC'],
      updates: [update('demo-company-2-u1', today, -5, 'progress', '订单域字段映射表确认，CDC 链路本地跑通')],
      todos: [todo('demo-company-2-t1', '联调订单域增量同步，核对 24 小时延迟', '我', today, 2)]
    },
    {
      id: 'demo-company-3', name: '移动端首屏性能优化', module: '公司项目', progress: 20, start: -25, due: 8, last: -6,
      summary: '首屏从 1.8s 压到 1s 以内：拆包、图片按需、接口并行。', tags: ['前端', '性能'],
      updates: [update('demo-company-3-u1', today, -6, 'note', '首屏耗时采样完成，定位到主包过大和串行请求')],
      todos: [todo('demo-company-3-t1', '拆首屏 JS 分包，砍掉未用依赖', '我', today, 3)]
    },
    {
      id: 'demo-company-4', name: '灰度发布平台上线', module: '公司项目', status: '已完成', progress: 100, start: -45, due: -12, last: -12,
      summary: '按用户维度灰度的发布平台，已接入全部核心服务。', tags: ['平台', 'CI/CD'],
      updates: [update('demo-company-4-u1', today, -12, 'decision', '全量发布完成，回滚预案与值班流程已归档')],
      todos: []
    },

    // ---------------------------------------------------------- 日常工作
    {
      id: 'demo-daily-1', name: '内部分享《线上问题定位实战》准备', module: '日常工作', progress: 45, start: -8, due: 2, last: -1,
      summary: '下周四内部分享，用三个真实 case 讲排查思路：从火焰图到链路日志。', tags: ['技术分享', '可观测'],
      updates: [update('demo-daily-1-u1', today, -1, 'progress', '大纲和两个 case 定了，还差一个内存泄漏的分析过程')],
      todos: [
        todo('demo-daily-1-t1', '补第三个 case 的火焰图与结论', '我', today, 0),
        todo('demo-daily-1-t2', '对着同事预讲一遍，控制在 40 分钟', '我', today, 1)
      ]
    },
    {
      id: 'demo-daily-2', name: 'Q3 技术季度汇报', module: '日常工作', progress: 35, start: -14, due: 9, last: -3,
      summary: '向主管汇报本季度技术产出：稳定性、性能、效率三块指标与下季规划。', tags: ['汇报', 'OKR'],
      updates: [update('demo-daily-2-u1', today, -3, 'progress', '稳定性与性能两块指标已收集完，等效率部分的埋点数据')],
      todos: [todo('demo-daily-2-t1', '补性能优化前后的对比数据与图表', '我', today, 5)]
    },
    {
      id: 'demo-daily-3', name: '线上告警值班与故障复盘', module: '日常工作', progress: 70, start: -9, due: -3, last: -3,
      summary: '本周告警值班：处理 P2 告警、写复盘、把结论沉淀进值班手册。', tags: ['值班', '稳定性'],
      updates: [update('demo-daily-3-u1', today, -3, 'note', '两次 P2 告警的复盘初稿写完，等负责人确认根因')],
      todos: [todo('demo-daily-3-t1', '把复盘结论同步进值班手册和监控规则', '我', today, -2)]
    },
    {
      id: 'demo-daily-4', name: '依赖升级与技术债清理', module: '日常工作', progress: 15, start: -10, due: 5, last: -2,
      summary: '把几个高危依赖升到安全版本，顺手删掉两次迭代前留下的兼容代码。', tags: ['技术债', '依赖'],
      updates: [update('demo-daily-4-u1', today, -2, 'note', '扫出 3 个高危依赖和 1 处废弃兼容层，升级分支已建')],
      todos: [todo('demo-daily-4-t1', '升级并跑通全量回归', '我', today, -1)]
    },

    // ---------------------------------------------------------- 其他项目
    {
      id: 'demo-other-1', name: '自研服务监控小工具', module: '其他项目', status: '阻塞', progress: 15, start: -8, due: 20, last: -2,
      summary: '自己写个小工具盯接口 P99 与慢 SQL，异常时推到企业微信。', tags: ['工具', '可观测'],
      updates: [update('demo-other-1-u1', today, -2, 'blocker', '等运维开采集端的只读权限，本地只能用假数据跑')],
      todos: [todo('demo-other-1-t1', '确认采集端权限范围与账号', '运维', today, 2)]
    },
    {
      id: 'demo-other-2', name: '开源项目 issue 与 PR 维护', module: '其他项目', progress: 50, start: -8, due: 3, last: -1,
      summary: '维护自己那个小开源库：回 issue、审 PR、发一个小版本。', tags: ['开源', '社区'],
      updates: [update('demo-other-2-u1', today, -1, 'progress', '合并了两个社区 PR，CI 全绿')],
      todos: [todo('demo-other-2-t1', '回复剩下的 6 个 issue 并打标签', '我', today, 2)]
    },
    {
      id: 'demo-other-3', name: '技术笔记与博客整理', module: '其他项目', progress: 25, start: -5, due: 14, last: -4,
      summary: '把散在各处的排查笔记和源码阅读记录整理成可检索的博客。', tags: ['学习', '写作'],
      updates: [update('demo-other-3-u1', today, -4, 'note', '先按主题分了 6 类：并发、存储、网络、JVM、框架源码、排查')],
      todos: [todo('demo-other-3-t1', '整理「分布式事务」一节并画流程图', '我', today, 7)]
    },
    {
      id: 'demo-other-4', name: '副业小程序原型', module: '其他项目', status: '待启动', progress: 0, start: 0, due: 25, last: 0,
      summary: '先用两周做个能跑通的最小闭环，验证一下这个想法值不值得继续。', tags: ['副业', '原型'],
      updates: [],
      todos: [todo('demo-other-4-t1', '写一页验证目标与技术选型', '我', today, 3)]
    }
  ]
  return specs.map((spec) => make(today, spec))
}

/** 生成示例数据时的提示语。 */
export function sampleSummary(projects) {
  const byModule = {}
  for (const project of projects) byModule[project.module] = (byModule[project.module] ?? 0) + 1
  const detail = Object.entries(byModule).map(([name, count]) => `${name} ${count} 个`).join('、')
  return `${projects.length} 个示例项目（${detail}）`
}
