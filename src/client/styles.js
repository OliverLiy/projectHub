/**
 * 面板样式：优先复用宿主的设计令牌（--dsw-*），拿不到时退回自己的回退值，
 * 这样在 Desktop 里跟主题一致，在 Node 里做渲染测试也能跑。
 *
 * 布局用容器查询而不是媒体查询：面板宽度由宿主分配，跟视口宽度无关。
 * 模块强调色用 --pc-accent-h 一个色相变量驱动，卡条、圆点、页签都跟着它走。
 */
export const STYLE_ID = 'dsh-project-console-style'

export const CSS = `
.pc-root{
  --pc-bg:var(--dsw-alias-bg-base,#ffffff);
  --pc-panel:var(--dsw-alias-bg-layer-2,#ffffff);
  --pc-sunken:color-mix(in srgb,var(--pc-text) 5%,var(--pc-panel));
  --pc-hover:color-mix(in srgb,var(--pc-text) 6%,transparent);
  --pc-text:var(--dsw-alias-label-primary,#16181d);
  --pc-text-2:var(--dsw-alias-label-secondary,#596171);
  --pc-text-3:var(--dsw-alias-label-tertiary,#7b8496);
  --pc-text-4:var(--dsw-alias-label-caption,#9aa2b1);
  --pc-line:var(--dsw-alias-border-l1,rgba(0,0,0,.06));
  --pc-line-2:var(--dsw-alias-border-l2,rgba(0,0,0,.10));
  --pc-line-3:var(--dsw-alias-border-l3,rgba(0,0,0,.16));
  --pc-brand:var(--dsw-alias-brand-primary,#16181d);
  --pc-brand-fill:var(--dsw-alias-button-primary-fill,#16181d);
  --pc-brand-hover:var(--dsw-alias-button-primary-hover,#2b303b);
  --pc-on-brand:var(--dsw-alias-label-primary-foreground,#ffffff);
  --pc-danger:var(--dsw-alias-state-error-primary,#d92d20);
  --pc-warn:var(--dsw-alias-state-warn-primary,#b54708);
  --pc-ok:var(--dsw-alias-state-success-primary,#067647);
  --pc-info:var(--dsw-alias-state-business-primary,#2f6bff);
  --pc-danger-soft:color-mix(in srgb,var(--pc-danger) 13%,transparent);
  --pc-warn-soft:color-mix(in srgb,var(--pc-warn) 15%,transparent);
  --pc-ok-soft:color-mix(in srgb,var(--pc-ok) 13%,transparent);
  --pc-info-soft:color-mix(in srgb,var(--pc-info) 13%,transparent);
  --pc-r-xs:var(--dsw-radius-xs,4px);
  --pc-r-sm:var(--dsw-radius-sm,8px);
  --pc-r-md:var(--dsw-radius-md,12px);
  --pc-r-lg:var(--dsw-radius-lg,16px);
  --pc-shadow-1:0 1px 2px rgba(16,24,40,.05);
  --pc-shadow-2:0 8px 22px rgba(16,24,40,.10);
  --pc-shadow-3:0 20px 48px rgba(16,24,40,.20);
  --pc-accent-h:239;

  position:relative;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;
  container-type:inline-size;container-name:pc-app;
  background:var(--pc-bg);color:var(--pc-text);
  font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif);
  font-size:13px;line-height:1.55;-webkit-font-smoothing:antialiased;box-sizing:border-box;
}
.pc-root *,.pc-root *::before,.pc-root *::after{box-sizing:border-box}
.pc-root :where(button,input,select,textarea){font:inherit;color:inherit}
.pc-root ::-webkit-scrollbar{width:10px;height:10px}
.pc-root ::-webkit-scrollbar-thumb{background:var(--pc-line-3);border:3px solid transparent;background-clip:content-box;border-radius:999px}
.pc-root ::-webkit-scrollbar-thumb:hover{background:var(--pc-text-4);background-clip:content-box}
.pc-root ::-webkit-scrollbar-track{background:transparent}
.pc-root :focus-visible{outline:2px solid var(--pc-info);outline-offset:2px;border-radius:var(--pc-r-xs)}
@media (prefers-reduced-motion:reduce){.pc-root *{transition:none!important;animation:none!important}}

/* 模块强调色 */
.pc-accent-indigo{--pc-accent-h:239}
.pc-accent-teal{--pc-accent-h:173}
.pc-accent-amber{--pc-accent-h:32}
.pc-accent-violet{--pc-accent-h:271}
.pc-accent-rose{--pc-accent-h:346}
.pc-accent-cyan{--pc-accent-h:189}
.pc-root .pc-accent{--pc-accent:hsl(var(--pc-accent-h) 72% 56%)}
.pc-card,.pc-rail-item,.pc-mini,.pc-module{--pc-accent:hsl(var(--pc-accent-h) 72% 56%)}

/* 语义色（SVG 里用 currentColor） */
.pc-c-danger{color:var(--pc-danger)}
.pc-c-warn{color:var(--pc-warn)}
.pc-c-ok{color:var(--pc-ok)}
.pc-c-info{color:var(--pc-info)}
.pc-c-muted{color:var(--pc-text-4)}
.pc-dot{width:7px;height:7px;border-radius:999px;background:currentColor;flex:0 0 auto;display:inline-block}
.pc-accent-dot{width:7px;height:7px;border-radius:2px;background:hsl(var(--pc-accent-h) 72% 56%);flex:0 0 auto;display:inline-block}
.pc-root .pc-link{border:0;background:transparent;padding:0;cursor:pointer;color:var(--pc-text);text-align:left;text-decoration:underline;text-decoration-color:var(--pc-line-3);text-underline-offset:3px}
.pc-root .pc-link:hover{text-decoration-color:var(--pc-info);color:var(--pc-info)}

/* ---------------------------------------------------------------- 顶栏 */
.pc-header{
  display:flex;align-items:center;gap:12px;flex:0 0 auto;height:58px;padding:0 16px;
  border-bottom:1px solid var(--pc-line);background:var(--pc-panel);
}
.pc-brand{display:flex;align-items:center;gap:10px;min-width:0}
.pc-brand-mark{
  display:grid;place-items:center;width:32px;height:32px;border-radius:10px;flex:0 0 auto;
  background:linear-gradient(150deg,var(--pc-brand-fill),color-mix(in srgb,var(--pc-brand-fill) 62%,var(--pc-info)));
  color:var(--pc-on-brand);box-shadow:var(--pc-shadow-1)
}
.pc-brand-text{display:flex;flex-direction:column;min-width:0}
.pc-brand-title{font-size:14px;font-weight:600;letter-spacing:.01em;white-space:nowrap}
.pc-brand-sub{font-size:11px;color:var(--pc-text-3);white-space:nowrap}
.pc-header-spacer{flex:1 1 auto;min-width:8px}
.pc-search{position:relative;display:flex;align-items:center;flex:0 1 300px;min-width:120px}
.pc-search .pc-icon{position:absolute;left:9px;color:var(--pc-text-4);pointer-events:none}
.pc-search input{
  width:100%;height:32px;padding:0 28px 0 30px;border:1px solid var(--pc-line-2);border-radius:999px;
  background:var(--pc-sunken);transition:border-color .15s,background .15s,box-shadow .15s;
}
.pc-search input:hover{border-color:var(--pc-line-3)}
.pc-search input:focus{outline:none;border-color:var(--pc-info);background:var(--pc-panel);box-shadow:0 0 0 3px var(--pc-info-soft)}
.pc-search-clear{position:absolute;right:7px;display:grid;place-items:center;width:20px;height:20px;border:0;border-radius:999px;background:transparent;color:var(--pc-text-3);cursor:pointer}
.pc-search-clear:hover{background:var(--pc-hover);color:var(--pc-text)}

/* ------------------------------------------------------------ 视图页签 */
.pc-viewtabs{
  display:flex;align-items:center;gap:2px;flex:0 0 auto;padding:6px 14px;min-height:44px;
  border-bottom:1px solid var(--pc-line);background:var(--pc-panel);overflow-x:auto;
}
.pc-viewtab{
  display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:0;border-radius:var(--pc-r-sm);
  background:transparent;color:var(--pc-text-2);cursor:pointer;white-space:nowrap;
  transition:background .15s,color .15s;
}
.pc-viewtab:hover{background:var(--pc-hover);color:var(--pc-text)}
.pc-viewtab[aria-selected=true]{background:color-mix(in srgb,var(--pc-info) 14%,transparent);color:var(--pc-info);font-weight:600}
.pc-viewtabs-spacer{flex:1 1 auto;min-width:12px}
.pc-scope{font-size:11px;color:var(--pc-text-3);white-space:nowrap;font-variant-numeric:tabular-nums}

/* ---------------------------------------------------------------- 按钮 */
.pc-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;
  border:1px solid transparent;border-radius:var(--pc-r-sm);background:transparent;color:var(--pc-text);
  cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,color .15s,box-shadow .15s;
}
.pc-btn:hover:not(:disabled){background:var(--pc-hover)}
.pc-btn:disabled{opacity:.45;cursor:not-allowed}
.pc-btn-primary{background:var(--pc-brand-fill);color:var(--pc-on-brand);box-shadow:var(--pc-shadow-1)}
.pc-btn-primary:hover:not(:disabled){background:var(--pc-brand-hover)}
.pc-btn-outline{border-color:var(--pc-line-2);background:var(--pc-panel)}
.pc-btn-outline:hover:not(:disabled){border-color:var(--pc-line-3);background:var(--pc-sunken)}
.pc-btn-danger{color:var(--pc-danger)}
.pc-btn-danger:hover:not(:disabled){background:var(--pc-danger-soft)}
.pc-btn-sm{height:26px;padding:0 9px;font-size:12px;border-radius:var(--pc-r-xs)}
.pc-iconbtn{
  display:inline-grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid transparent;
  border-radius:var(--pc-r-sm);background:transparent;color:var(--pc-text-2);cursor:pointer;transition:background .15s,color .15s;
}
.pc-iconbtn:hover:not(:disabled){background:var(--pc-hover);color:var(--pc-text)}
.pc-iconbtn:disabled{opacity:.45;cursor:not-allowed}
.pc-iconbtn-sm{width:26px;height:26px;border-radius:var(--pc-r-xs)}
.pc-iconbtn-danger:hover:not(:disabled){background:var(--pc-danger-soft);color:var(--pc-danger)}
.pc-seg{display:inline-flex;gap:2px;padding:2px;border-radius:var(--pc-r-sm);background:var(--pc-sunken)}
.pc-seg button{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border:0;border-radius:var(--pc-r-xs);background:transparent;color:var(--pc-text-2);cursor:pointer}
.pc-seg button[aria-pressed=true]{background:var(--pc-panel);color:var(--pc-text);box-shadow:var(--pc-shadow-1)}

/* ---------------------------------------------------------------- 主体 */
.pc-main{display:flex;flex:1 1 auto;min-height:0;min-width:0}
.pc-rail{
  display:flex;flex-direction:column;gap:14px;flex:0 0 208px;min-width:0;padding:14px 10px;
  border-right:1px solid var(--pc-line);background:var(--pc-panel);overflow:auto;
}
.pc-rail-group{display:flex;flex-direction:column;gap:2px;min-width:0}
.pc-rail-label{padding:0 8px 4px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--pc-text-4)}
.pc-rail-item{
  position:relative;display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:0;
  border-radius:var(--pc-r-sm);background:transparent;color:var(--pc-text-2);cursor:pointer;text-align:left;
  transition:background .15s,color .15s;
}
.pc-rail-item:hover{background:var(--pc-hover);color:var(--pc-text)}
.pc-rail-item[aria-current=true]{background:color-mix(in srgb,var(--pc-accent) 13%,transparent);color:var(--pc-text);font-weight:600}
.pc-rail-item[aria-current=true]::before{
  content:'';position:absolute;left:0;top:6px;bottom:6px;width:3px;border-radius:999px;background:var(--pc-accent);
}
.pc-rail-item-name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc-rail-count{flex:0 0 auto;font-size:11px;color:var(--pc-text-4);font-variant-numeric:tabular-nums}
.pc-rail-item[aria-current=true] .pc-rail-count{color:var(--pc-text-2)}
.pc-rail-foot{margin-top:auto;display:flex;flex-direction:column;gap:7px;padding:9px 8px 4px;border-top:1px solid var(--pc-line)}
.pc-rail-state{font-size:10.5px;color:var(--pc-text-3)}
.pc-rail-actions{display:flex;gap:6px;flex-wrap:wrap}
.pc-rail-note{font-size:10px;line-height:1.5;color:var(--pc-text-4)}

.pc-content{flex:1 1 auto;min-width:0;min-height:0;overflow:auto;padding:16px 18px 30px;display:flex;flex-direction:column;gap:16px}

/* ------------------------------------------------------------------ KPI */
.pc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:10px}
.pc-kpi{
  position:relative;display:flex;flex-direction:column;gap:2px;padding:11px 13px;border:1px solid var(--pc-line-2);
  border-radius:var(--pc-r-md);background:var(--pc-panel);transition:border-color .15s,box-shadow .15s,transform .15s;
}
.pc-kpi:hover{border-color:var(--pc-line-3);box-shadow:var(--pc-shadow-1);transform:translateY(-1px)}
.pc-kpi-top{display:flex;align-items:center;gap:6px;color:var(--pc-text-3);font-size:11.5px}
.pc-kpi-value{font-size:25px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.pc-kpi-foot{font-size:11px;color:var(--pc-text-4)}
.pc-kpi-danger .pc-kpi-value{color:var(--pc-danger)}
.pc-kpi-warn .pc-kpi-value{color:var(--pc-warn)}
.pc-kpi-ok .pc-kpi-value{color:var(--pc-ok)}

/* -------------------------------------------------------------- 面板块 */
.pc-panel-block{
  display:flex;flex-direction:column;gap:12px;padding:14px 15px;border:1px solid var(--pc-line-2);
  border-radius:var(--pc-r-md);background:var(--pc-panel);min-width:0;
}
.pc-panel-head{display:flex;align-items:center;gap:8px;color:var(--pc-text-3)}
.pc-panel-head h3{margin:0;font-size:12.5px;font-weight:600;color:var(--pc-text);letter-spacing:.01em}
.pc-panel-head .pc-spacer{flex:1 1 auto}
.pc-dash-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(242px,1fr));gap:14px;align-items:start}
.pc-hero{flex-direction:row;align-items:center;gap:12px}
.pc-hero-mark{
  display:grid;place-items:center;width:34px;height:34px;border-radius:10px;flex:0 0 auto;
  background:var(--pc-info-soft);color:var(--pc-info)
}
.pc-hero-title{font-size:12.5px;color:var(--pc-text-3)}
.pc-hero-sub{font-size:14px;font-weight:600;letter-spacing:-.01em}

/* -------------------------------------------------------------- 图与表 */
.pc-donut{position:relative;flex:0 0 auto}
.pc-donut-track{stroke:var(--pc-sunken)}
.pc-donut-slice{stroke:currentColor;transition:stroke-dasharray .3s ease}
.pc-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}
.pc-donut-center b{font-size:22px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums}
.pc-donut-center span{font-size:10.5px;color:var(--pc-text-4)}
.pc-donut-wrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.pc-legend{display:flex;flex-direction:column;gap:5px;margin:0;padding:0;list-style:none;min-width:120px;flex:1 1 auto}
.pc-legend li{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--pc-text-2)}
.pc-legend i{width:9px;height:9px;border-radius:3px;background:currentColor;flex:0 0 auto}
.pc-legend b{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--pc-text)}

.pc-stacked{display:flex;flex-direction:column;gap:10px}
.pc-stacked-head{display:flex;align-items:baseline;gap:8px;font-size:12px}
.pc-stacked-label{color:var(--pc-text);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc-stacked-meta{margin-left:auto;font-size:11px;color:var(--pc-text-4);white-space:nowrap}
.pc-stacked-track{display:flex;height:9px;border-radius:999px;background:var(--pc-sunken);overflow:hidden;margin-top:5px}
.pc-stacked-seg{display:block;height:100%;background:currentColor;transition:width .3s ease}
.pc-stacked-seg+.pc-stacked-seg{margin-left:1px}

.pc-hist{display:flex;align-items:flex-end;gap:8px;height:150px;padding-top:6px}
.pc-hist-col{flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;min-width:0}
.pc-hist-track{flex:1 1 auto;width:100%;display:flex;align-items:flex-end;justify-content:center}
.pc-hist-bar{width:70%;max-width:34px;border-radius:6px 6px 3px 3px;background:linear-gradient(180deg,var(--pc-info),color-mix(in srgb,var(--pc-info) 55%,transparent));transition:height .3s ease}
.pc-hist-empty{background:var(--pc-sunken)}
.pc-hist-col b{font-size:12px;font-variant-numeric:tabular-nums}
.pc-hist-col span{font-size:10px;color:var(--pc-text-4);white-space:nowrap}

.pc-rank{display:flex;flex-direction:column;gap:9px}
.pc-rank-row{display:grid;grid-template-columns:76px 1fr 26px auto;align-items:center;gap:8px;font-size:12px}
.pc-rank-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--pc-text-2)}
.pc-rank-track{position:relative;display:flex;height:9px;border-radius:999px;background:var(--pc-sunken);overflow:hidden}
.pc-rank-fill{display:block;height:100%;background:hsl(var(--pc-accent-h) 72% 56%);opacity:.75}
.pc-rank-danger{display:block;height:100%;background:var(--pc-danger)}
.pc-rank-row b{font-variant-numeric:tabular-nums;text-align:right}
.pc-rank-row small{color:var(--pc-text-4);font-size:10.5px;white-space:nowrap}

.pc-attn-list{display:flex;flex-direction:column}
.pc-attn{display:grid;grid-template-columns:auto 1fr auto auto auto;align-items:center;gap:9px;padding:7px 4px;border:0;border-bottom:1px solid var(--pc-line);background:transparent;cursor:pointer;text-align:left;width:100%;border-radius:var(--pc-r-xs)}
.pc-attn:last-child{border-bottom:0}
.pc-attn:hover{background:var(--pc-hover)}
.pc-attn-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}

/* ---------------------------------------------------------------- 卡片 */
.pc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:10px}
.pc-card{
  position:relative;display:flex;flex-direction:column;gap:9px;padding:12px 13px 12px 15px;
  border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-panel);
  cursor:pointer;text-align:left;overflow:hidden;
  transition:border-color .15s,box-shadow .18s,transform .18s;
}
.pc-card:hover{border-color:var(--pc-accent);box-shadow:var(--pc-shadow-2);transform:translateY(-2px)}
.pc-card-accent{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--pc-accent);opacity:.85}
.pc-card-top{display:flex;align-items:flex-start;gap:8px;min-width:0}
.pc-card-name{flex:1 1 auto;font-size:13.5px;font-weight:600;line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.pc-card-sum{font-size:11.5px;color:var(--pc-text-3);overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}
.pc-card-tags{display:flex;gap:5px;flex-wrap:wrap}
.pc-tag{display:inline-flex;align-items:center;height:19px;padding:0 7px;border-radius:var(--pc-r-xs);background:var(--pc-sunken);color:var(--pc-text-3);font-size:10.5px;white-space:nowrap}
.pc-card-foot{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--pc-text-3);flex-wrap:wrap}
.pc-card-foot b{color:var(--pc-text-2);font-weight:600;font-variant-numeric:tabular-nums}
.pc-progress{height:4px;border-radius:999px;background:var(--pc-sunken);overflow:hidden}
.pc-progress>i{display:block;height:100%;border-radius:999px;background:var(--pc-brand-fill);transition:width .25s}
.pc-progress-danger>i{background:var(--pc-danger)}
.pc-progress-warn>i{background:var(--pc-warn)}
.pc-progress-ok>i{background:var(--pc-ok)}
.pc-badge{display:inline-flex;align-items:center;gap:5px;height:21px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:500;white-space:nowrap;border:1px solid transparent}
.pc-badge i{width:5px;height:5px;border-radius:999px;background:currentColor}
.pc-tone-danger{background:var(--pc-danger-soft);color:var(--pc-danger);border-color:color-mix(in srgb,var(--pc-danger) 26%,transparent)}
.pc-tone-warn{background:var(--pc-warn-soft);color:var(--pc-warn);border-color:color-mix(in srgb,var(--pc-warn) 26%,transparent)}
.pc-tone-ok{background:var(--pc-ok-soft);color:var(--pc-ok);border-color:color-mix(in srgb,var(--pc-ok) 24%,transparent)}
.pc-tone-info{background:var(--pc-info-soft);color:var(--pc-info);border-color:color-mix(in srgb,var(--pc-info) 24%,transparent)}
.pc-tone-muted{background:var(--pc-sunken);color:var(--pc-text-3);border-color:var(--pc-line-2)}
.pc-pill{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;background:var(--pc-sunken);color:var(--pc-text-3);font-size:11px;font-variant-numeric:tabular-nums}

/* -------------------------------------------------------------- 模块分组 */
.pc-module{display:flex;flex-direction:column;gap:10px}
.pc-module-head{display:flex;align-items:center;gap:9px;padding:0 2px}
.pc-module-title{font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:8px}
.pc-module-bar{width:3px;height:15px;border-radius:999px;background:var(--pc-accent)}
.pc-module-meta{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--pc-text-3);flex-wrap:wrap}

/* ---------------------------------------------------------------- 看板 */
.pc-kanban{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:6px}
.pc-kanban-col{
  flex:1 1 0;min-width:188px;display:flex;flex-direction:column;gap:9px;padding:11px;
  border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-sunken);
}
.pc-kanban-head{display:flex;align-items:center;gap:7px;font-size:12.5px}
.pc-kanban-head b{font-weight:600}
.pc-kanban-body{display:flex;flex-direction:column;gap:7px}
.pc-mini{
  position:relative;display:flex;flex-direction:column;gap:5px;padding:9px 10px 9px 12px;border:1px solid var(--pc-line-2);
  border-radius:var(--pc-r-sm);background:var(--pc-panel);cursor:pointer;text-align:left;overflow:hidden;
  transition:border-color .15s,box-shadow .15s,transform .15s;
}
.pc-mini::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--pc-accent)}
.pc-mini:hover{border-color:var(--pc-accent);box-shadow:var(--pc-shadow-1);transform:translateY(-1px)}
.pc-mini-name{font-size:12.5px;font-weight:600;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.pc-mini-meta{display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--pc-text-3);flex-wrap:wrap}

/* ---------------------------------------------------------------- 列表 */
.pc-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}
.pc-table th{position:sticky;top:0;z-index:1;padding:9px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--pc-text-3);background:var(--pc-panel);border-bottom:1px solid var(--pc-line-2);white-space:nowrap}
.pc-table td{padding:10px;border-bottom:1px solid var(--pc-line);vertical-align:middle}
.pc-table tbody tr{cursor:pointer}
.pc-table tbody tr:hover td{background:var(--pc-hover)}
.pc-table .pc-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.pc-table .pc-name{font-weight:600;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc-table .pc-name .pc-accent-dot{margin-right:7px;vertical-align:middle}
.pc-table-wrap{border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-panel);overflow:hidden}

/* ---------------------------------------------------------------- 日历 */
.pc-cal{display:flex;flex-direction:column;gap:12px}
.pc-cal-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pc-cal-title{display:flex;align-items:baseline;gap:9px}
.pc-cal-title b{font-size:15px;font-weight:600}
.pc-cal-actions{margin-left:auto;display:flex;align-items:center;gap:6px}
.pc-cal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.pc-cal-weekdays span{padding:2px 0;text-align:center;font-size:10.5px;color:var(--pc-text-4)}
.pc-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.pc-cal-cell{
  display:flex;flex-direction:column;gap:4px;min-height:84px;padding:6px 7px;border:1px solid var(--pc-line);
  border-radius:var(--pc-r-sm);background:var(--pc-panel);cursor:pointer;text-align:left;overflow:hidden;
  transition:border-color .15s,box-shadow .15s,background .15s;
}
.pc-cal-cell:hover{border-color:var(--pc-line-3);box-shadow:var(--pc-shadow-1)}
.pc-cal-weekend{background:color-mix(in srgb,var(--pc-text) 3%,var(--pc-panel))}
.pc-cal-out{opacity:.42}
.pc-cal-today{border-color:var(--pc-info);box-shadow:0 0 0 1px var(--pc-info-soft) inset}
.pc-cal-selected{border-color:var(--pc-accent);background:color-mix(in srgb,var(--pc-info) 7%,var(--pc-panel))}
.pc-cal-day{font-size:11px;color:var(--pc-text-2);font-variant-numeric:tabular-nums}
.pc-cal-today .pc-cal-day{display:inline-grid;place-items:center;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:var(--pc-info);color:var(--pc-on-brand);font-weight:600}
.pc-cal-items{display:flex;flex-direction:column;gap:3px;min-width:0}
.pc-cal-chip{
  display:block;padding:2px 6px;border-radius:var(--pc-r-xs);font-size:10.5px;line-height:1.45;
  background:color-mix(in srgb,currentColor 14%,transparent);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.pc-cal-more{font-size:10px;color:var(--pc-text-4)}
.pc-cal-detail{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-panel)}
.pc-cal-list{display:flex;flex-direction:column}
.pc-cal-row{display:grid;grid-template-columns:auto auto 1fr auto auto;align-items:center;gap:9px;padding:7px 2px;border-bottom:1px solid var(--pc-line);font-size:12px}
.pc-cal-row:last-child{border-bottom:0}

/* -------------------------------------------------------------- 时间线 */
.pc-tl{display:flex;flex-direction:column;gap:8px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-panel);padding:12px 14px;overflow:hidden}
.pc-tl-note{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--pc-text-3)}
.pc-tl-head{display:grid;grid-template-columns:186px 1fr;gap:10px;padding-bottom:6px;border-bottom:1px solid var(--pc-line)}
.pc-tl-head-name{font-size:11px;color:var(--pc-text-4)}
.pc-tl-axis{position:relative;height:18px}
.pc-tl-axis span{position:absolute;top:0;transform:translateX(-50%);font-size:10.5px;color:var(--pc-text-4);white-space:nowrap}
.pc-tl-body{position:relative;display:flex;flex-direction:column}
.pc-tl-todayline{position:absolute;top:0;bottom:0;width:1px;background:var(--pc-info);opacity:.55;pointer-events:none}
.pc-tl-todayline::after{content:'';position:absolute;top:-3px;left:-2.5px;width:6px;height:6px;border-radius:999px;background:var(--pc-info)}
.pc-tl-row{display:grid;grid-template-columns:186px 1fr;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid var(--pc-line)}
.pc-tl-row:last-child{border-bottom:0}
.pc-tl-name{display:flex;align-items:center;gap:7px;border:0;background:transparent;padding:0 4px 0 0;cursor:pointer;text-align:left;min-width:0;color:var(--pc-text)}
.pc-tl-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.pc-tl-name:hover{color:var(--pc-info)}
.pc-tl-track{position:relative;height:26px;border-radius:var(--pc-r-xs);background:var(--pc-sunken)}
.pc-tl-bar{
  position:absolute;top:4px;height:18px;display:flex;align-items:center;gap:6px;padding:0 8px;border:0;border-radius:999px;
  background:color-mix(in srgb,currentColor 30%,transparent);cursor:pointer;min-width:26px;overflow:hidden;
  transition:filter .15s;
}
.pc-tl-bar:hover{filter:brightness(1.06) saturate(1.15)}
.pc-tl-bar em{font-style:normal;font-size:10px;white-space:nowrap;color:currentColor}
.pc-tl-bar i{font-style:normal;font-size:10px;color:var(--pc-text-3);white-space:nowrap}

/* -------------------------------------------------------------- 待跟进 */
.pc-follow{display:flex;flex-direction:column;gap:14px}
.pc-follow-group{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-md);background:var(--pc-panel)}
.pc-follow-row{display:grid;grid-template-columns:auto 1fr auto auto auto auto;align-items:center;gap:9px;padding:7px 2px;border-bottom:1px solid var(--pc-line);font-size:12.5px}
.pc-follow-row:last-child{border-bottom:0}
.pc-follow-row input[type=checkbox]{width:15px;height:15px;accent-color:var(--pc-brand-fill);cursor:pointer}
.pc-follow-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc-follow-due{font-size:11px;color:var(--pc-text-4);white-space:nowrap;font-variant-numeric:tabular-nums}

/* ------------------------------------------------------------------ 空态 */
.pc-empty{display:flex;flex-direction:column;align-items:center;gap:9px;padding:46px 20px;border:1px dashed var(--pc-line-3);border-radius:var(--pc-r-md);color:var(--pc-text-3);text-align:center}
.pc-empty-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:999px;background:var(--pc-sunken);color:var(--pc-text-3)}
.pc-empty-title{font-size:13.5px;font-weight:600;color:var(--pc-text)}
.pc-empty .pc-btn{margin-top:2px}
.pc-skeleton{border-radius:var(--pc-r-md);background:var(--pc-sunken);animation:pc-pulse 1.4s ease-in-out infinite}
.pc-skeleton-line{height:10px;border-radius:999px;background:var(--pc-sunken);animation:pc-pulse 1.4s ease-in-out infinite}
@keyframes pc-pulse{0%,100%{opacity:1}50%{opacity:.55}}

/* ---------------------------------------------------------------- AI */
.pc-ai{display:flex;flex-direction:column;gap:10px}
.pc-ai-actions{display:flex;align-items:center;gap:10px}
.pc-ai-result{display:flex;flex-direction:column;gap:10px;padding-top:4px;border-top:1px solid var(--pc-line)}
.pc-ai-source{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--pc-text-3);flex-wrap:wrap}
.pc-plan{display:flex;flex-direction:column;gap:10px;padding:11px 12px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-sm);background:var(--pc-sunken)}
.pc-plan-group{display:flex;flex-direction:column;gap:5px}
.pc-plan-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--pc-text)}
.pc-plan-lines{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px}
.pc-plan-lines li{font-size:12.5px;color:var(--pc-text-2);word-break:break-word}
.pc-undobar{
  display:flex;align-items:center;gap:9px;padding:9px 12px;border:1px solid color-mix(in srgb,var(--pc-ok) 30%,transparent);
  border-left:3px solid var(--pc-ok);border-radius:var(--pc-r-sm);background:var(--pc-ok-soft);font-size:12.5px;
}
.pc-undobar .pc-spacer{flex:1 1 auto}

/* --------------------------------------------------------- 抽屉 / 弹窗 */
.pc-scrim{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-2,rgba(16,24,40,.28));z-index:40;animation:pc-fade .16s ease-out}
@keyframes pc-fade{from{opacity:0}to{opacity:1}}
.pc-sheet{
  position:absolute;top:0;right:0;bottom:0;z-index:41;display:flex;flex-direction:column;width:min(480px,92%);
  border-left:1px solid var(--pc-line-2);background:var(--pc-panel);box-shadow:var(--pc-shadow-3);
  animation:pc-slide .2s cubic-bezier(.22,.61,.36,1);
}
@keyframes pc-slide{from{transform:translateX(18px);opacity:.4}to{transform:none;opacity:1}}
.pc-sheet-head{display:flex;align-items:flex-start;gap:10px;padding:15px 16px;border-bottom:1px solid var(--pc-line-2)}
.pc-sheet-title{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:6px}
.pc-sheet-title h2{margin:0;font-size:16px;font-weight:600;line-height:1.3;word-break:break-word}
.pc-sheet-body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:16px}
.pc-sheet-foot{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--pc-line-2);background:var(--pc-panel)}
.pc-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}
.pc-fact{display:flex;flex-direction:column;gap:1px;padding:9px 11px;border:1px solid var(--pc-line);border-radius:var(--pc-r-sm);background:var(--pc-sunken)}
.pc-fact span{font-size:10.5px;color:var(--pc-text-4)}
.pc-fact strong{font-size:12.5px;font-weight:600;word-break:break-word}
.pc-block{display:flex;flex-direction:column;gap:9px}
.pc-block-head{display:flex;align-items:center;gap:8px}
.pc-block-head h3{margin:0;font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--pc-text-3)}
.pc-block-head .pc-spacer{flex:1 1 auto}

.pc-composer{display:flex;gap:7px;align-items:center}
.pc-input,.pc-select,.pc-textarea{width:100%;height:32px;padding:0 10px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-sm);background:var(--pc-panel);transition:border-color .15s,box-shadow .15s}
.pc-select{appearance:none;padding-right:26px;background-image:linear-gradient(45deg,transparent 50%,var(--pc-text-4) 50%),linear-gradient(135deg,var(--pc-text-4) 50%,transparent 50%);background-position:calc(100% - 14px) 14px,calc(100% - 9px) 14px;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.pc-textarea{height:auto;min-height:78px;padding:9px 10px;resize:vertical;line-height:1.6}
.pc-input:hover,.pc-select:hover,.pc-textarea:hover{border-color:var(--pc-line-3)}
.pc-input:focus,.pc-select:focus,.pc-textarea:focus{outline:none;border-color:var(--pc-info);box-shadow:0 0 0 3px var(--pc-info-soft)}

.pc-timeline{display:flex;flex-direction:column;gap:2px}
.pc-timeline-item{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--pc-line)}
.pc-timeline-item:last-child{border-bottom:0}
.pc-timeline-rail{display:flex;flex-direction:column;align-items:center;gap:4px;flex:0 0 auto;padding-top:4px}
.pc-timeline-dot{width:7px;height:7px;border-radius:999px;background:var(--pc-text-4)}
.pc-timeline-dot-blocker{background:var(--pc-danger)}
.pc-timeline-dot-progress{background:var(--pc-ok)}
.pc-timeline-dot-decision{background:var(--pc-info)}
.pc-timeline-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.pc-timeline-meta{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--pc-text-4)}
.pc-timeline-text{word-break:break-word;font-size:12.5px}

.pc-todo{display:flex;align-items:center;gap:9px;padding:6px 0;border-bottom:1px solid var(--pc-line)}
.pc-todo:last-child{border-bottom:0}
.pc-todo input[type=checkbox]{width:15px;height:15px;accent-color:var(--pc-brand-fill);flex:0 0 auto;cursor:pointer}
.pc-todo-title{flex:1 1 auto;min-width:0;word-break:break-word}
.pc-todo-done .pc-todo-title{color:var(--pc-text-4);text-decoration:line-through}
.pc-todo-due{font-size:11px;color:var(--pc-text-4);white-space:nowrap}
.pc-todo-due-over{color:var(--pc-danger)}

.pc-ask{display:flex;flex-direction:column;gap:10px}
.pc-ask-row{display:flex;align-items:center;gap:8px}
.pc-ask-row .pc-search{flex:1 1 auto;max-width:none}
.pc-chips{display:flex;gap:6px;flex-wrap:wrap}
.pc-chips-center{justify-content:center}
.pc-chip-btn{height:26px;padding:0 10px;border:1px solid var(--pc-line-2);border-radius:999px;background:var(--pc-panel);color:var(--pc-text-2);cursor:pointer;font-size:12px;transition:background .15s,border-color .15s,color .15s}
.pc-chip-btn:hover{background:var(--pc-sunken);border-color:var(--pc-line-3);color:var(--pc-text)}
.pc-answer{padding:11px 13px;border:1px solid var(--pc-line-2);border-left:3px solid var(--pc-info);border-radius:var(--pc-r-sm);background:var(--pc-sunken);white-space:pre-wrap;word-break:break-word}
.pc-doc{width:100%;min-height:190px;padding:12px 13px;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-sm);background:var(--pc-sunken);resize:vertical;font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:1.7}
.pc-doc:focus{outline:none;border-color:var(--pc-info);box-shadow:0 0 0 3px var(--pc-info-soft)}

.pc-modal{
  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:41;display:flex;flex-direction:column;
  width:min(560px,94%);max-height:88%;border:1px solid var(--pc-line-2);border-radius:var(--pc-r-lg);
  background:var(--pc-panel);box-shadow:var(--pc-shadow-3);animation:pc-pop .18s cubic-bezier(.22,.61,.36,1);
}
@keyframes pc-pop{from{opacity:.3;transform:translate(-50%,-48%) scale(.98)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.pc-modal-head{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid var(--pc-line-2)}
.pc-modal-head h2{margin:0;font-size:15px;font-weight:600;flex:1 1 auto}
.pc-modal-body{padding:16px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px}
.pc-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:13px 18px;border-top:1px solid var(--pc-line-2)}
.pc-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pc-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.pc-field>span{font-size:11.5px;font-weight:500;color:var(--pc-text-2)}
.pc-field>small{font-size:10.5px;color:var(--pc-text-4)}
.pc-field-span{grid-column:1 / -1}
.pc-range{display:flex;align-items:center;gap:10px}
.pc-range input[type=range]{flex:1 1 auto;accent-color:var(--pc-brand-fill)}
.pc-range b{min-width:38px;text-align:right;font-variant-numeric:tabular-nums}

.pc-toast{
  position:absolute;left:50%;bottom:20px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:8px;
  max-width:80%;padding:9px 14px;border-radius:999px;background:var(--dsw-alias-toast-bg,rgba(22,24,29,.94));
  color:var(--dsw-alias-toast-label,#fff);box-shadow:var(--pc-shadow-2);font-size:12.5px;animation:pc-rise .2s ease-out;
}
@keyframes pc-rise{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
.pc-toast-danger{background:var(--pc-danger)}
.pc-notice{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--pc-warn) 30%,transparent);border-left:3px solid var(--pc-warn);border-radius:var(--pc-r-sm);background:var(--pc-warn-soft)}
.pc-notice-danger{border-color:color-mix(in srgb,var(--pc-danger) 30%,transparent);border-left-color:var(--pc-danger);background:var(--pc-danger-soft)}
.pc-notice-body{flex:1 1 auto;display:flex;flex-direction:column;gap:6px}
.pc-muted{color:var(--pc-text-3);font-size:11.5px}
.pc-mono{font-family:var(--dsw-font-family-mono,ui-monospace,Menlo,monospace);font-size:11.5px}

/* --------------------------------------------------------- 窄面板适配 */
@container pc-app (max-width:900px){
  .pc-rail{flex-basis:172px}
  .pc-cards{grid-template-columns:repeat(auto-fill,minmax(224px,1fr))}
  .pc-viewtab{padding:0 9px}
}
@container pc-app (max-width:760px){
  .pc-main{flex-direction:column}
  .pc-rail{flex:0 0 auto;flex-direction:row;gap:6px;padding:8px 10px;border-right:0;border-bottom:1px solid var(--pc-line);overflow-x:auto;overflow-y:hidden}
  .pc-rail-group{flex-direction:row;gap:6px;align-items:center}
  .pc-rail-label,.pc-rail-foot{display:none}
  .pc-rail-item{width:auto;height:28px;padding:0 10px;border:1px solid var(--pc-line-2);border-radius:999px}
  .pc-rail-item[aria-current=true]{border-color:transparent}
  .pc-rail-item[aria-current=true]::before{display:none}
  .pc-search{flex-basis:150px}
  .pc-brand-sub,.pc-scope{display:none}
  .pc-content{padding:12px}
  .pc-form{grid-template-columns:1fr}
  .pc-cal-cell{min-height:64px}
  .pc-cal-chip{display:none}
  .pc-tl-head,.pc-tl-row{grid-template-columns:120px 1fr}
  .pc-tl-todayline{left:calc(120px + (100% - 120px) * .5)}
}
@container pc-app (max-width:560px){
  .pc-search{display:none}
  .pc-kpis{grid-template-columns:repeat(auto-fit,minmax(104px,1fr))}
  .pc-cards{grid-template-columns:1fr}
  .pc-viewtab span{display:none}
}
`
