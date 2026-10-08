/** 工作台客户端入口：向 Desktop 注册业务面板。 */
import React from 'react'
import { ConsoleView, ProjectConsole } from './panel.js'
const REPOSITORY = 'https://github.com/OliverLiy/projectHub'

export function apply(ctx) {
  ctx.effect(() => ctx.desktopWorkbenches.register({
    title: '项目总控台',
    repository: REPOSITORY,
    description: '按模块管理全部项目：状态、进度、待跟进与 DDL 风险一屏看完，可问询、可生成汇报文档。',
    panelTitle: '项目总控台',
    category: '项目管理',
    icon: '📋',
    // embedded + businessSide: left 是宿主支持的"左侧嵌入式业务面板"结构：
    // 顶栏作为根节点首个子元素，macOS 收起侧栏时宿主会为窗口按钮预留宽度。
    embedded: true,
    layout: { businessSide: 'left', businessWidth: 0.68 }
  }, ProjectConsole), 'project-console: register workbench')
}

export const inject = ['desktopWorkbenches']

// 额外导出便于不启动 Desktop 也能渲染面板做自测；模块加载器只读取 apply/inject。
export { ConsoleView, ProjectConsole }
