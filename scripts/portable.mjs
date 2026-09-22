import { mkdir, writeFile } from 'node:fs/promises';
const directory = 'release/win-unpacked';
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/portable.flag`, 'LP Studio portable mode\n');
await writeFile(`${directory}/READ-ME.txt`, 'LP Studio Windows desktop\r\n\r\nDouble-click LP Studio.exe. Copy the whole folder, not just the exe.\r\nData is stored in .lp-data beside the exe. Close the app before copying.\r\nAPI keys must be re-entered on another Windows account or computer.\r\nInstall/login your CLI tools separately. Use Settings to relocate moved projects.\r\n', 'utf8');
console.log(`Portable desktop ready: ${directory}/LP Studio.exe`);
