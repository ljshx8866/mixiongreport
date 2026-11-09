type ApiEnvelope<T> = { code: string | number; msg?: string; data?: T };
const JSONbig = require('json-bigint')({ storeAsString: true });
type PageInfo = { pageNo: number; pageTotal: number; pageSize: number; totalSize: number };

export type WuuxiangShop = {
  shop_id: number | string;
  shop_code: string;
  shop_name: string;
  brand_name?: string;
  region_name?: string;
  sly_code?: string | null;
};

export type WuuxiangBill = {
  bs_id: string;
  delflg: number;
  state: number | string;
  settle_shift_id?: string;
  settle_time: string;
  open_time?: string;
  last_total: number;
  income_total: number;
  people_qty: number;
  sale_type_name: string;
  item?: Array<{ item_id: string; item_name: string; last_qty: number; last_total: number; delflg?: number; pkg_flg_name?: string; sales_revenue_type_id?: string }>;
  settleDetail?: Array<{ payway_name: string; income_money: number; delflg?: number }>;
};
export type WuuxiangTicket = {
  bsId: string;
  bizType: string | number;
  deFromName: string;
  settleBizDate: string;
  ticketCount: string | number;
  ticketState: string;
  billState: string;
  pwDetailId: string;
  pwDetailld?: string;
  ticketCode: string;
  incomeMoney: number;
};
export type WuuxiangCategory = { class_id: string; class_code: string; class_name: string; level: number; parent_id: string; delflg: number };
export type WuuxiangProduct = { item_id: string; item_code: string; item_name: string; small_class_id: string; big_class_id: string; std_price?: number; cost_price?: number; delflg: number; is_enable?: boolean | number | string; is_package?: boolean | number | string };
export type WuuxiangEmployee = {
  id: string;
  code: string;
  name: string;
  dutyId?: string;
  dutyName?: string;
  cellphone?: string;
  shopId?: string | number;
};
export type WuuxiangEmployeeAccess = {
  id: string;
  code: string;
  name: string;
  isEnable: boolean;
  isAdmin: boolean;
  authAccessShopList?: Array<{ id: string | number; code?: string; name?: string }>;
};

/** One instance per app process. The POS invalidates old tokens when a new one is requested. */
export class WuuxiangClient {
  private token: string | null = null;
  private expiresAt = 0;
  private tokenRequest: Promise<string> | null = null;
  private readonly base = 'https://cysms.wuuxiang.com';

  constructor(
    private readonly appId: string,
    private readonly accessId: string,
    private readonly centerId: string,
  ) {}

  private async authenticate(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      const url = new URL('/api/auth/accesstoken', this.base);
      url.searchParams.set('appid', this.appId);
      url.searchParams.set('accessid', this.accessId);
      url.searchParams.set('response_type', 'token');
      const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`POS authentication HTTP ${response.status}`);
      const body = await response.json() as { code: string | number; msg?: string; access_token?: string; expires_in?: number };
      if (String(body.code) !== '0' || !body.access_token) throw new Error(`POS authentication failed: ${body.code} ${body.msg ?? ''}`);
      this.token = body.access_token;
      this.expiresAt = Date.now() + Math.max(1, Number(body.expires_in ?? 1200) - 60) * 1000;
      return this.token;
    })();
    try { return await this.tokenRequest; }
    finally { this.tokenRequest = null; }
  }

  private async request<T>(path: string, params: Record<string, string | number>, retry = true): Promise<T> {
    const token = await this.authenticate();
    const url = new URL(path, this.base);
    for (const [key, value] of Object.entries({ centerId: this.centerId, ...params })) url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      method: 'POST',
      headers: { access_token: token, accessid: this.accessId, granttype: 'client' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`POS ${path} HTTP ${response.status}`);
    const body = JSONbig.parse(await response.text()) as ApiEnvelope<T>;
    if (['-400001', '-400004'].includes(String(body.code)) && retry) {
      // Another request may already have refreshed the token while this one
      // was in flight. Never discard that newer token.
      if (this.token === token) {
        this.token = null;
        this.expiresAt = 0;
      }
      return this.request<T>(path, params, false);
    }
    if (String(body.code) !== '0' || body.data == null) throw new Error(`POS ${path} failed: ${body.code} ${body.msg ?? ''}`);
    return body.data;
  }

  private async pages<T>(path: string, params: Record<string, string | number>, key: string | string[], pageSize = 50): Promise<T[]> {
    const all: T[] = [];
    for (let pageNo = 1; pageNo <= 1000; pageNo++) {
      const data = await this.request<Record<string, unknown>>(path, { ...params, pageNo, pageSize });
      const keys = Array.isArray(key) ? key : [key];
      const rows = keys.map((k) => data[k]).find(Array.isArray);
      if (!Array.isArray(rows)) throw new Error(`POS ${path} did not return ${keys.join(' or ')}; data keys: ${Object.keys(data).join(', ')}`);
      all.push(...rows as T[]);
      const info = data.pageInfo as PageInfo | undefined;
      if (!info || pageNo >= Number(info.pageTotal)) return all;
    }
    throw new Error(`POS ${path} exceeded 1000 pages`);
  }

  shops(): Promise<WuuxiangShop[]> {
    return this.pages<WuuxiangShop>('/api/datatransfer/getshops', {}, 'shopList');
  }

  categories(shopId: string): Promise<WuuxiangCategory[]> {
    return this.pages<WuuxiangCategory>('/api/datatransfer/getitemcategoryinfo', { shopId }, 'category');
  }

  products(shopId: string): Promise<WuuxiangProduct[]> {
    return this.pages<WuuxiangProduct>('/api/datatransfer/getitems', { shopId }, 'item', 300);
  }

  employees(): Promise<WuuxiangEmployee[]> {
    return this.pages<WuuxiangEmployee>('/api/datatransfer/getEmpArchives', { shopId: -1 }, 'empList');
  }

  async employeeAccessShops(): Promise<WuuxiangEmployeeAccess[]> {
    const data = await this.request<Record<string, unknown>>('/api/datatransfer/getEmpAccessShops', {});
    if (!Array.isArray(data.empList)) throw new Error(`POS employee access response did not return empList; data keys: ${Object.keys(data).join(', ')}`);
    return data.empList as WuuxiangEmployeeAccess[];
  }

  bills(shopId: string, settleDate: string, needPkgDetail = false): Promise<WuuxiangBill[]> {
    return this.pages<WuuxiangBill>('/api/datatransfer/getserialdata', { shopId, settleDate, dateType: 2, needPkgDetail: needPkgDetail ? 1 : 0 }, 'billList', 500);
  }

  businessSituation(shopId: string, settleDate: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/api/datatransfer/getBusinessSituation', { shopId, settleDate, dateType: 2 });
  }

  tickets(shopId: string, begin: string, end: string): Promise<WuuxiangTicket[]> {
    return this.pages<WuuxiangTicket>('/api/datatransfer/getO2oTicket', { shopId, begin, end }, ['ticketDataList', 'dataList', 'billList'], 500);
  }
}
