# 聊天界面参考与复刻范围

核对日期：2026-10-28。微信和 QQ 的基础聊天界面采用腾讯当前在 Apple App Store 中国区展示的 iOS 产品截图；iMessage 采用 Apple 当前 iPhone 使用手册截图。原图均已下载并查看。

Apple Lookup 查询得到微信 8.0.80、QQ 9.3.78，两个版本均于 2026-10-23 发布。版本日期仅代表应用版本，不能证明商店宣传截图也是同日更新。商店图未覆盖全部特殊消息；红包、转账、文件、定位、通话等卡片已按主题分开渲染，但尚缺覆盖每种卡片的当前实机参考，不能认定它们全部逐像素一致。

## 微信 · 群聊

- 应用：微信，版本 8.0.80
- 应用页面：https://apps.apple.com/cn/app/id414478124
- 图片原地址：https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/15/76/a7/1576a71e-6ec8-92af-6ec6-a715e78a0ca3/021c1617-8529-4b9e-8951-cbb57d3ef5ab_2_U7fa4_U804a_ios_1242_U00d72208.png/392x696bb.png
- 本地留档：[wechat 官方参考图](./wechat-group-official.png)

## QQ · 合养秋秋人（聊天页与输入栏）

- 应用：QQ，版本 9.3.78
- 应用页面：https://apps.apple.com/cn/app/id444934666
- 图片原地址：https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/4f/fb/c4/4ffbc43b-923c-60a0-fb74-0df13d1a2915/208214ed53dc1b088244ee4b548ca2f7_2_U5408_U517b_U79cb_U79cb_U4eba.jpg/320x480bb.jpg
- 本地留档：[qq 官方参考图](./qq-chat-official.png)

## 具体对应

| 元素 | 微信参考 | QQ 参考 |
| --- | --- | --- |
| 顶栏 | 浅灰底、居中标题与括号人数、右侧三个实心点 | 浅色底、左对齐标题与状态、右侧三横线 |
| 气泡 | 四角均为小圆角，头像侧有短尖角，绿底黑字 | 四角均为圆角，无微信式尖角，蓝底白字 |
| 头像 | 小圆角方形 | 圆形 |
| 输入区 | 单行：圆圈声波、空白输入框、表情、圆圈加号 | 上行空白输入框；下行语音、图片、相机、红包、表情、加号 |
| 消息时间 | 消息流独立居中时间；不放在单条消息下方 | 同左 |
| 装饰 | 无气泡投影、无点阵壁纸、无渐变顶栏 | 同左 |

画布为 402 × 874 CSS px，手机外观模拟 iPhone 17 Pro 的屏幕比例、灵动岛及安全区。参考截图中的广告标题、放大的头像、宠物和活动贴纸属于宣传装饰，不进入编辑器生成的聊天页。手机状态栏采用左侧时间、中央灵动岛和右侧连接 / 电池图标的布局；这不是对所有历史 iOS / Android 版本的逐像素复制。

旧草稿会迁移此前的默认字号、壁纸、气泡圆角和背景色；用户单独调整过的颜色、消息、角色、群聊内容仍然保留。可用“恢复当前平台默认外观”恢复参考外观。

## iMessage · Apple 当前使用手册

- [发送与回复信息](https://support.apple.com/guide/iphone/send-and-reply-to-messages-iph82fb73ba3/ios)
- [共享位置](https://support.apple.com/guide/iphone/share-your-location-iph69b192bc2/ios)
- [手册截图一](./apple-messages-current.png)，[原图](https://ipcdn-web.apple.com/assets/v2/web/24a996a5-b9d6-41f5-acd9-4b8207decaf5)
- [对话截图](./apple-imessage-conversation.png)，[原图](https://ipcdn-web.apple.com/assets/v2/web/5b3d9796-554a-4396-86dd-4d19bfc285de)

据图调整了顶部圆形联系人头像、姓名入口、圆形返回按钮、底部加号、胶囊输入框、音频入口和蓝 / 灰气泡。iMessage 不显示腾讯红包、转账、戳一戳和通话卡片；切换主题时保留原始数据，可在「所有消息」列表中找到被隐藏的条目。默认地图为本地绘制的示意图，用户可上传地图截图替换。

## QQ 戳一戳表情资源

使用腾讯官方 QQ 表情资源 `/戳一戳`（emojiId 181），没有用系统手势 emoji 替代。

- 定义索引：[QQNT 资源索引](https://koishi.js.org/QFace/assets/qq_emoji/_index.v2.json)，索引同步时间 2026-09-28；资源原始发布时间为 2024-04-11。
- 腾讯原始资源：[181_base_1712825561.zip](https://wa.qq.com/qgif-web-permanent/sysemoji/v1/singleres/181_base_1712825561.zip)
- 从原始资源中提取 `181/png/181.png`，保存在 [qq-poke.png](../../assets/chat-editor/qq-poke.png)。资源版权归腾讯所有。

参考来源与核对范围保留在仓库文档，编辑器页面不显示这些文字。
