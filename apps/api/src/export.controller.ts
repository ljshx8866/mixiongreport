import { Controller, Get, ParseIntPipe, Query, Req, Res } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { DailyReportService } from './report.service';
import { assertStoreAccess, type RequestWithUser } from './auth';

const display = (value: number | null | undefined) => value == null ? '—' : value;
const money = (value: number | null | undefined) => value == null ? '—' : Number(value).toFixed(2);
const ratio = (value: number | null | undefined) => value == null ? '—' : `${(Number(value) * 100).toFixed(0)}%`;

@Controller('api/exports')
export class ExportController {
  constructor(private readonly reports: DailyReportService) {}

  @Get('daily.xlsx')
  async daily(@Req() request: RequestWithUser, @Res() response: any, @Query('storeId', ParseIntPipe) storeId: number, @Query('date') date: string) {
    assertStoreAccess(request.user, storeId);
    const report: any = await this.reports.getDailyReport(storeId, date);
    const book = new Workbook(); const sheet = book.addWorksheet('经营日报');
    sheet.columns = [{ width: 22 }, { width: 16 }, { width: 14 }, { width: 16 }, { width: 14 }];
    sheet.mergeCells('A1:E1'); sheet.getCell('A1').value = `${report.store.brandName}（${report.store.name}）${date}经营日报`;
    sheet.getCell('A1').font = { bold: true, size: 16 }; sheet.getCell('A1').alignment = { horizontal: 'center' };
    const addSection = (name: string, headers: string[], rows: unknown[][]) => {
      const section = sheet.addRow([name]); sheet.mergeCells(`A${section.number}:E${section.number}`); section.font = { bold: true, color: { argb: 'FFFFFFFF' } }; section.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };
      const header = sheet.addRow(headers); header.font = { bold: true }; header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFED7AA' } };
      rows.forEach((row) => sheet.addRow(row)); sheet.addRow([]);
    };
    addSection('经营核心数据', ['销售类型', '销售额', '入客数', '客单价', '占总销售'], [
      ['总计', money(report.sales?.total.amount), display(report.sales?.total.customers), money(report.sales?.total.avgOrderValue), '100%'],
      ['堂食', money(report.sales?.dineIn.amount), display(report.sales?.dineIn.customers), money(report.sales?.dineIn.avgOrderValue), ratio(report.sales?.dineIn.ratio)],
      ['外卖', money(report.sales?.delivery.amount), display(report.sales?.delivery.customers), money(report.sales?.delivery.avgOrderValue), ratio(report.sales?.delivery.ratio)],
    ]);
    addSection('营业时段统计', ['时段', '销售额', '入客数', '客单价', '占总销售'], report.periods.map((x: any) => [x.name, money(x.amount), display(x.customers), money(x.avgOrderValue), ratio(x.ratio)]));
    addSection('团购统计', ['团购渠道', '销售额', '入客数', '客单价', '占总销售'], [['团购总计', money(report.groupBuy.total.amount), display(report.groupBuy.total.customers), money(report.groupBuy.total.avgOrderValue), ratio(report.groupBuy.total.ratio)], ...report.groupBuy.platforms.map((x: any) => [x.name, money(x.amount), display(x.customers), money(x.avgOrderValue), ratio(x.ratio)])]);
    addSection('能源与人工效率', ['指标', '数值', '指标', '数值', ''], [['总用电', display(report.energy.totalPower), '电效率', money(report.energy.powerEfficiency), ''], ['用水', display(report.energy.waterUsage), '水效率', money(report.energy.waterEfficiency), ''], ['总工时', display(report.labor.hours), '工时收入', money(report.labor.salesPerHour), '']]);
    addSection('运营指标', ['指标', '数值', '指标', '数值', ''], [['加点人数', display(report.operations.addonCustomers), '千人加点', money(report.operations.addonPerThousand), ''], ['套餐人数', display(report.operations.comboCustomers), '千人套餐', money(report.operations.comboPerThousand), '']]);
    addSection('菜品分类统计', ['分类', '销量', '', '', ''], report.categorySales.map((x: any) => [x.categoryName, x.quantity, '', '', '']));
    for (const category of report.productSales) addSection(`${category.categoryName} 菜品销售明细`, ['排名', '菜品', '销量', '', ''], category.items.map((item: any) => [item.rank, item.productName, item.quantity, '', '']));
    sheet.eachRow((row) => { row.alignment = { vertical: 'middle' }; row.eachCell((cell) => { cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } }; }); });
    const fileName = `daily-report-${storeId}-${date}.xlsx`;
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(Buffer.from(await book.xlsx.writeBuffer()));
  }
}
