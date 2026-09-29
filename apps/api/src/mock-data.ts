import { ReportSource, RawProduct } from '@restaurant/report-engine';

const categories = [
  { id: 1, name: '盖饭', items: [['西红柿鸡蛋盖饭', 80], ['招牌黑金卤肉饭', 67], ['宫保鸡丁盖饭', 47], ['外婆菜炒鸡蛋盖饭', 31], ['辣椒炒肉盖饭', 25], ['咖喱鸡肉盖饭', 22], ['鱼香肉丝盖饭', 21], ['麻婆豆腐盖饭', 13], ['香辣卤肉盖饭', 13]] as [string, number][] },
  { id: 2, name: '罐罐米线/面', items: [['招牌罐罐米线', 23], ['酸辣罐罐米线', 15], ['牛肉罐罐面', 11]] as [string, number][] },
  { id: 3, name: '拌面', items: [['香辣拌面', 5], ['葱油拌面', 3]] as [string, number][] },
  { id: 4, name: '锅贴', items: [['鲜肉锅贴', 103], ['虾仁锅贴', 75]] as [string, number][] },
  { id: 5, name: '晚餐罐罐', items: [['晚餐牛肉罐罐', 1]] as [string, number][] },
  { id: 6, name: '豆花', items: [['红糖豆花', 20], ['原味豆花', 16]] as [string, number][] },
  { id: 7, name: '饮料', items: [['酸梅汤', 29], ['柠檬茶', 25]] as [string, number][] },
];

export const mockProducts: RawProduct[] = categories.flatMap((category) => category.items.map(([productName, quantity], index) => ({
  productId: category.id * 100 + index + 1,
  productName,
  categoryId: category.id,
  categoryName: category.name,
  categoryOrder: category.id,
  quantity,
  salesAmount: 0,
})));

export const mockReportSource: ReportSource = {
  store: { id: 1, name: '山大店', brandName: '米熊' },
  date: '2026-09-27',
  sales: {
    total: { amount: 5644.74, customers: 389 },
    dineIn: { amount: 3308.56, customers: 190 },
    delivery: { amount: 2336.18, customers: 199 },
  },
  periods: [
    { code: 'LUNCH', name: '午餐', amount: 4043.21, customers: 276 },
    { code: 'DINNER', name: '晚餐', amount: 1601.53, customers: 113 },
  ],
  platforms: [
    { code: 'DOUYIN', name: '抖音', amount: 352.10, customers: 17 },
    { code: 'MEITUAN', name: '美团点评', amount: 157.20, customers: 8 },
    { code: 'AMAP', name: '高德团购', amount: 0, customers: 0 },
  ],
  products: mockProducts,
  manual: {
    kitchenPower: 207.70, diningPower: 40.41, fullDayPower: 25.98, airConditionPower: 2.31,
    totalPower: null, waterUsage: 2, laborHours: 55, addonCustomers: 29, comboCustomers: null, status: 'SUBMITTED',
  },
  powerMode: 'SUM_COMPONENTS',
  reportStatus: 'SUBMITTED', apiDataReady: true, productDataReady: true,
};
