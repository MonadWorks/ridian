# 日点 · RIDIAN

白色悬浮球与每日清单。奶黄色的浅光晕、安静的完成动效，以及可被 AI 读取和管理的本地记录。

## 使用

- 打开 `~/Applications/日点.app`。点击小圆点展开，点击右上角横线或按 Esc 收起。
- 拖动小圆点或面板标题移动位置。切换到其他应用后淡为半透明，移回鼠标恢复。
- 输入事项，回车添加；点击圆圈完成，再次点击撤销。双击文字编辑。
- 右键事项设置「优先做 / 按平常 / 慢慢来」。淡金色小点表示优先，浅灰绿色表示低优先级，普通事项不加标记。
- 鼠标悬停显示删除按钮。未完成事项自动留在今天，原始计划日期仍保留。
- `⌘ ⇧ Space` 展开或收起。菜单栏小圆圈也可以唤出清单，右键菜单栏图标查看菜单。
- 左下角打开每日记录；右下角 `···` 提供导出、AI 配置、在线记录页、登录启动与退出。

每日记录页有年度热力图、每日清单、完成总数、活跃天数与最长连续天数。热力图按实际完成日期计数，历史计划日期与后来完成的日期分别保留。撤销完成会同时更新统计。

## 数据和连接

数据在 `~/Library/Application Support/Ridian/`：

- `journal.json`：任务与重复策略，写入使用临时文件、fsync 和原子替换。
- `backups/YYYY-MM-DD.json`：每天第一次修改前的备份。
- `connection.json`：本地 HTTP 地址、只读 `readToken` 和可写 `writeToken`。权限 `0600`。
- `preferences.json`：悬浮球的位置。

本地网页与桌面使用同一份数据。Vercel 页面通过本机接口读取，浏览器可能需要允许访问本地网络；在同一台 Mac 上保持日点运行即可。关闭桌面应用后，网页展示浏览器最近缓存的快照。**此版本不提供云端数据同步或其他设备自动同步。**可以导出 JSON 并在另一设备的记录页打开备份查看。网页上的「打开备份」只读预览，不覆盖桌面数据。浏览器缓存可通过「断开连接」清除。

在线记录页只携带只读密钥；密钥通过 URL fragment 传递，页面读取后立即从地址栏清除，不会发送给 Vercel。仅在当前浏览器标签页的 sessionStorage 保存连接密钥。任务快照保存在该浏览器的 localStorage；完成工作后可手动断开。

## AI HTTP 接口

基地址 `http://127.0.0.1:43127`。所有数据接口需要 `Authorization: Bearer <token>`，JSON 请求体使用 `Content-Type: application/json`。应用仅监听本机地址；CORS 仅允许本地页面及配置中的部署域名。

在日点菜单「AI 接口」中复制只读或读写配置。也可由本机 AI 从上述 `connection.json` 读取；不要把这个文件放进 Git 或公开上传。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v1/today` | 今日事项，包括前几天未完成的事项 |
| GET | `/api/v1/tasks?date=2026-10-26` | 查询某天计划或完成的任务；不带 date 返回全部 |
| GET | `/api/v1/history` | 完整记录、策略、时区和当前本地日期 |
| GET | `/api/v1/export` | 完整 JSON 备份 |
| POST | `/api/v1/tasks` | 添加事项 |
| PATCH | `/api/v1/tasks/:id` | 更新标题、优先级、计划日期或完成状态 |
| DELETE | `/api/v1/tasks/:id` | 删除事项 |
| GET / POST | `/api/v1/strategies` | 查看 / 新增重复策略 |
| PATCH / DELETE | `/api/v1/strategies/:id` | 更新 / 删除策略 |

只读密钥的写入请求返回 403。无效密钥返回 401。创建与编辑成功返回 200 和 JSON。

添加事项：

```json
{"title":"复习第一章","date":"2026-10-27","priority":"high"}
```

`date` 默认当天，`priority` 默认 `normal`，支持 `high`、`normal`、`low`。

更新事项：

```json
{"done":true}
```

`done:false` 撤销完成。`title`、`date` 和 `priority` 可独立修改。

每隔 3 天复习：

```json
{
  "title":"复习第一章",
  "priority":"high",
  "startDate":"2026-10-27",
  "endDate":"2026-12-31",
  "schedule":{"type":"interval","everyDays":3},
  "metadata":{"source":"ai","topic":"第一章"}
}
```

每周一、周五：

```json
{"title":"每周回顾","schedule":{"type":"weekly","weekdays":[1,5]}}
```

指定间隔复习日期（由 AI 计算间隔即可）：

```json
{
  "title":"复习：记忆曲线",
  "startDate":"2026-10-27",
  "schedule":{"type":"dates","dates":["2026-10-27","2026-10-28","2026-10-30","2026-11-03","2026-11-10"]},
  "metadata":{"reviewIntervals":[0,1,3,7,14],"notes":"AI 可在此保存自己的策略上下文"}
}
```

`weekdays` 使用 0=周日到 6=周六。`enabled:false` 暂停策略，删除或暂停不删除已经生成的事项。后台每 30 秒检查一次，并在应用启动或接口访问时补齐到期任务；相同策略在相同日期只生成一次。未来日期的事项到当天才生成。遵循电脑当前本地日期与时区；应用退出时不常驻调度，重新打开会补齐。策略 `metadata` 支持最多 4000 字符的 JSON 对象，以容纳 AI 的复习逻辑。此版本不提供小时级提醒、推送通知或自动 AI 推理。

AI 的最小读取示例（不输出密钥）：

```python
import json, pathlib, urllib.request
config = json.loads((pathlib.Path.home() / 'Library/Application Support/Ridian/connection.json').read_text())
request = urllib.request.Request(config['baseUrl'] + '/api/v1/today', headers={'Authorization': 'Bearer ' + config['readToken']})
print(urllib.request.urlopen(request).read().decode())
```

## 开发与检查

```sh
npm install
npm test
npm start
# 独立运行桌面 + 网页交互检查（先退出日点，避免端口冲突）
node tests/desktop-smoke.cjs
npm run package
```

`npm run build` 生成可部署的 `dist/`，无运行时第三方依赖。桌面使用 Electron，静态前端使用原生 JS 与 CSS。`desktop/cloud.json` 保存允许读取本机数据的在线记录页地址；更换部署域名后需要更新该文件并重新打包。

程序是本机制作的 Apple Silicon macOS 应用，未进行 Apple 公证；在此电脑上本地构建与运行。分发到其他电脑前需按 Apple 要求签名、公证。
