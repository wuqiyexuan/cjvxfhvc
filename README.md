<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/15621ef2-cad6-42f8-a2dd-733b6198129b

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## 本版更新
- 修复“全部分组”下拉面板在横向滚动容器内被裁切导致无法点击/显示的问题。
- 分组下拉菜单改为固定定位，点击分组可直接切换。
- 分组上下移动改为按分组名称持久化排序，外部横向分组顺序同步。
- ST 角色卡支持多个自定义标签，保存后参与搜索和卡片标签显示。
- ST 插件和脚本名称统一为大写 ST。
- 侧边栏新增 User 人设、生图两个空白板块。


## 数据安全恢复
本版本对旧版分片存储增加缺失字段回退读取：如果检测到分片字段不存在，会从旧根数据恢复后再加载，避免更新版本时将其他板块显示/保存为空。
