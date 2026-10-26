# Ridian

[![English](docs/assets/english.svg)](README.md) [![简体中文](docs/assets/chinese.svg)](README.zh-CN.md)

安静地陪在桌面上的每日清单。白色悬浮球、浅黄色光晕、轻柔的完成动效，以及可供 AI 读取和管理的本地记录。界面使用英文，待办内容支持中文和其他语言。

- **随时展开。** 点击悬浮球查看今天，切换到其他应用后自动淡为半透明。
- **优先级与自由排序。** 四档横向优先级滑轴；手动拖动可以覆盖默认排序。
- **回看每一天。** 年度热力图、每日清单和简单的完成统计。
- **为 AI 留好接口。** 本地 HTTP 接口、独立读写密钥，以及间隔、每周和指定日期的重复策略。

## 预览

以下为早期英文界面的空白状态截图，不含个人待办。当前版本还包含优先级滑轴和自由拖动排序，图中尚未展示。

<p align="center">
  <img src="docs/assets/widget-preview.png" width="356" alt="Ridian 白色悬浮清单的早期空白界面，带浅黄色光晕">
</p>

<p align="center">
  <img src="docs/assets/history-preview.jpg" width="900" alt="Ridian 记录页的早期空白界面，包含年度热力图和每日清单区域">
</p>

## 快速开始

桌面应用当前面向 **Apple Silicon macOS**。需要 **Node.js 22.12 或更新版本**。

```sh
git clone https://github.com/MonadWorks/ridian.git
cd ridian
npm ci
npm start
```

构建可独立打开的应用：

```sh
npm run package
open release/Ridian-darwin-arm64/Ridian.app
```

也可以把构建出的 `Ridian.app` 拷贝到 `~/Applications/`。本地构建使用临时签名，尚未进行 Apple 公证；向其他电脑分发前需要相应的签名与公证流程。

[在线记录页](https://ridian-journal.vercel.app) 可以连接同一台 Mac 上正在运行的 Ridian，也可以通过「Demo」查看示例数据。

## 使用

- 打开 `Ridian.app`。点击小圆点展开，点击右上角横线或按 Esc 收起。
- 拖动小圆点或面板标题移动位置。切换到其他应用后淡为半透明，移回鼠标恢复。
- 输入事项，回车添加；点击圆圈完成，再次点击撤销。双击文字编辑。
- 在「Add a task」右侧点击优先级按钮即可先选择，再添加事项。横向拖动白色滑块，轨道颜色连续变化，松手吸附到「Low / Normal / High / Urgent」四档之一；成功添加后回到 Normal。已有事项点击右侧圆点使用同一滑轴。← / → 选择、Enter 确认、Esc 取消。使用默认排序时，更改优先级会让清单平滑重排；手动顺序会保留。右键菜单也可设置优先级。
- 默认未完成事项按优先级排序，已完成事项排最后。拖动事项文字或悬停时出现的左侧手柄，可以跨优先级、跨完成状态自由调整；顺序会保存，刷新或重启不会排回去。新事项按默认规则插入，新勾选完成的事项先移到底部，也可再次拖动。菜单中的「Reset order」恢复默认排序。手柄获得键盘焦点后可用 ↑ / ↓、Home / End 移动。
- 鼠标悬停显示删除按钮。未完成事项自动留在今天，原始计划日期仍保留。
- `⌘ ⇧ Space` 展开或收起。菜单栏小圆圈也可以唤出清单，右键菜单栏图标查看菜单。
- 左下角打开每日记录；右下角 `···` 提供导出、AI 配置、在线记录页、登录启动与退出。

每日记录页有年度热力图、每日清单、完成总数、活跃天数与最长连续天数。热力图按实际完成日期计数，历史计划日期与后来完成的日期分别保留。撤销完成会同时更新统计。

## 数据和连接

数据在 `~/Library/Application Support/Ridian/`：

| 文件 | 内容 |
| --- | --- |
| `journal.json` | 任务、重复策略与手动排序。写入使用临时文件、`fsync` 和原子替换。 |
| `backups/YYYY-MM-DD.json` | 每天第一次修改前的备份。 |
| `connection.json` | 本地 HTTP 地址、只读 `readToken` 和可写 `writeToken`。权限为 `0600`。 |
| `preferences.json` | 悬浮球的位置。 |

本地网页与桌面使用同一份数据。Vercel 页面通过本机接口读取，浏览器可能需要允许访问本地网络；在同一台 Mac 上保持 Ridian 运行即可。关闭桌面应用后，网页展示浏览器最近缓存的快照。**此版本不提供云端数据同步或其他设备自动同步。**可以导出 JSON 并在另一设备的记录页打开备份查看。网页上的「Open backup」只读预览，不覆盖桌面数据。浏览器缓存可通过「Disconnect」清除。

在线记录页只携带只读密钥；密钥通过 URL fragment 传递，页面读取后立即从地址栏清除，不会发送给 Vercel。仅在当前浏览器标签页的 sessionStorage 保存连接密钥。任务快照保存在该浏览器的 localStorage；完成工作后可手动断开。

## AI HTTP 接口

基地址 `http://127.0.0.1:43127`。所有数据接口需要 `Authorization: Bearer <token>`，JSON 请求体使用 `Content-Type: application/json`。应用仅监听本机地址；CORS 仅允许本地页面及配置中的部署域名。

在 Ridian 菜单「AI access」中复制只读或读写配置。也可由本机 AI 从上述 `connection.json` 读取；不要把这个文件放进 Git 或公开上传。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v1/today` | 今日事项，包括前几天未完成的事项 |
| GET | `/api/v1/tasks?date=2026-10-26` | 查询某天计划或完成的任务；不带 date 返回全部 |
| GET | `/api/v1/history` | 完整记录、策略、时区和当前本地日期 |
| GET | `/api/v1/export` | 完整 JSON 备份 |
| POST | `/api/v1/tasks` | 添加事项 |
| PATCH | `/api/v1/tasks/:id` | 更新标题、优先级、计划日期或完成状态 |
| DELETE | `/api/v1/tasks/:id` | 删除事项 |
| POST | `/api/v1/order` | 手动移动今日事项：`{"id":"task-id","beforeId":"target-id"}`，`beforeId:null` 移到最后 |
| DELETE | `/api/v1/order` | 恢复默认排序 |
| GET / POST | `/api/v1/strategies` | 查看 / 新增重复策略 |
| PATCH / DELETE | `/api/v1/strategies/:id` | 更新 / 删除策略 |

只读密钥的写入请求返回 403。无效密钥返回 401。创建与编辑成功返回 200 和 JSON。

添加事项：

```json
{"title":"复习第一章","date":"2026-10-27","priority":"high"}
```

`date` 默认当天，`priority` 默认 `normal`，支持 `urgent`、`high`、`normal`、`low`。

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
npm test
# 使用合成数据在浏览器预览悬浮面板（不访问个人待办）
npm run preview:widget
# 独立运行桌面 + 网页交互检查（先退出 Ridian，避免端口冲突）
node tests/desktop-smoke.cjs
npm run build
npm run package
```

`npm run build` 生成可部署的 `dist/`，无运行时第三方依赖。桌面使用 Electron，静态前端使用原生 JS 与 CSS。`desktop/cloud.json` 保存允许读取本机数据的在线记录页地址；更换部署域名后需要更新该文件并重新打包。

修改文档时，请同时更新 `README.md` 和 `README.zh-CN.md`，保留顶部语言切换按钮，并保持功能说明、命令、示例与限制一致。预览图片只使用空白状态或合成数据。

## 许可证

[MIT](LICENSE)。
