import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'docs', 'templates');
const outputPath = path.join(outputDir, '员工批量导入模板.xlsx');
await mkdir(outputDir, { recursive: true });

const workbook = new ExcelJS.Workbook();
workbook.creator = '米熊经营系统';
workbook.subject = '在职员工及账号批量导入';
workbook.title = '员工批量导入模板';
workbook.created = new Date();
workbook.modified = new Date();

const employees = workbook.addWorksheet('员工导入', {
  views: [{ state: 'frozen', ySplit: 1 }],
});
employees.columns = [
  { header: '姓名*', key: 'name', width: 18 },
  { header: '手机号*', key: 'mobile', width: 18, style: { numFmt: '@' } },
  { header: '所属门店*', key: 'store', width: 24 },
  { header: '岗位*', key: 'position', width: 20 },
  { header: '入职日期*', key: 'effectiveDate', width: 18 },
  { header: '身份证号', key: 'idNumber', width: 24, style: { numFmt: '@' } },
  { header: '性别', key: 'gender', width: 12 },
  { header: '出生日期', key: 'birthDate', width: 18 },
  { header: '住址', key: 'address', width: 32 },
  { header: '开户银行', key: 'bankName', width: 20 },
  { header: '银行卡号', key: 'bankCard', width: 28, style: { numFmt: '@' } },
  { header: '备注', key: 'remark', width: 28 },
];
employees.autoFilter = 'A1:L101';
employees.getRow(1).height = 30;
employees.getRow(1).eachCell((cell) => {
  cell.font = { name: 'Microsoft YaHei', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF243B53' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = { bottom: { style: 'medium', color: { argb: 'FFF07832' } } };
});
for (let row = 2; row <= 101; row += 1) {
  employees.getRow(row).height = 23;
  employees.getRow(row).eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF243B53' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = {
      bottom: { style: 'hair', color: { argb: 'FFD9E2EC' } },
      right: { style: 'hair', color: { argb: 'FFE6EDF3' } },
    };
    if (row % 2 === 0) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8FA' } };
    }
  });
  employees.getCell(`B${row}`).numFmt = '@';
  employees.getCell(`F${row}`).numFmt = '@';
  employees.getCell(`K${row}`).numFmt = '@';
  employees.getCell(`G${row}`).dataValidation = {
    type: 'list', allowBlank: true, formulae: ['"男,女"'],
  };
}
employees.getColumn('B').note = '必填，11 位手机号；作为账号唯一匹配字段，请按文本填写。';
employees.getColumn('C').note = '必填，名称必须与系统门店列表完全一致。';
employees.getColumn('D').note = '必填，岗位必须已在后台创建，并已关联该门店及工时工资。';
employees.getColumn('E').note = '必填，格式 YYYY-MM-DD；作为员工任职及岗位工资生效日期。';
employees.getColumn('F').note = '选填，按文本填写；包含身份证等个人敏感信息，请仅在安全渠道传输。';
employees.getColumn('K').note = '选填，按文本填写，避免长号码被 Excel 转成科学计数法。';

const guide = workbook.addWorksheet('填写说明', {
  views: [{ state: 'frozen', ySplit: 2 }],
});
guide.columns = [
  { header: '项目', key: 'item', width: 25 },
  { header: '说明', key: 'description', width: 100 },
];
guide.addRows([
  ['用途', '直接导入已在职员工，不经过小程序入职申请和审批流程。每名员工一行。'],
  ['必填列', '姓名、手机号、所属门店、岗位、入职日期。不要删除或改动表头，不要合并单元格。'],
  ['门店与岗位', '所属门店和岗位名称须与后台现有名称完全一致。导入前，岗位必须已关联该门店，并已设置该门店的时薪。工资从“门店 + 岗位”的后台配置读取，模板不单独填写工资。'],
  ['入职日期', '使用 YYYY-MM-DD，例如 2026-10-01。该日期用于建立任职关系及工资生效记录。'],
  ['手机号与账号', '手机号须为有效的 11 位手机号，并且名单中不能重复。系统按手机号查找账号：已有账号时关联现有账号，不重复新建；没有账号时新建账号。'],
  ['默认权限', '新建或关联账号默认按员工权限处理；岗位名称本身不自动授予店长、管理或经营日报权限。需要管理权限的人员可另行标注在备注中，由管理员导入后配置。'],
  ['个人资料', '身份证号、性别、出生日期、住址、开户银行、银行卡号为选填。Excel 不嵌入身份证照片；如需归档照片，可在员工资料建立后另行上传。'],
  ['号码格式', '手机号、身份证号、银行卡号按文本填写，不要加空格、公式或科学计数法。日期统一使用 YYYY-MM-DD。'],
  ['安全提醒', '身份证号、住址和银行卡号属于敏感个人信息；只填写系统需要的内容，并通过受控渠道传输文件。'],
  ['示例（仅供格式参考，不会放入导入表）', '姓名：张三；手机号：13800138000；所属门店：高新店；岗位：店员；入职日期：2026-10-01。请勿将示例当作真实员工导入。'],
]);
guide.getRow(1).height = 30;
guide.getRow(1).eachCell((cell) => {
  cell.font = { name: 'Microsoft YaHei', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF243B53' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
});
guide.eachRow((row, rowNumber) => {
  if (rowNumber === 1) return;
  row.height = 42;
  row.eachCell((cell) => {
    cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF243B53' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9E2EC' } } };
  });
  row.getCell(1).font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FF243B53' } };
  if (rowNumber % 2 === 0) {
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8FA' } };
    });
  }
});

await workbook.xlsx.writeFile(outputPath);
console.log(outputPath);
