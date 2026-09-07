import { app } from 'electron'

// Windows 任务栏按 AppUserModelID 解析应用身份（归组与图标都查 AUMID 对应的快捷方式，
// 不看 exe 内嵌图标）。生产值必须与 package.json 的 build.appId 一致。
// dev 必须用独立 AUMID：electron.exe 若自称生产 AUMID，被 pin/记录后 Windows 会把
// 生产身份绑定到 electron.exe，打包版任务栏图标随之被劫持成 Electron logo
//（v1.8.7 任务栏图标 bug 根因：开始菜单残留指向 node_modules electron.exe 的
// Electron.lnk 与 ZDNotes 快捷方式共用 com.zdn.notes）。
export const APP_USER_MODEL_ID = app.isPackaged ? 'com.zdn.notes' : 'com.zdn.notes.dev'
