export const TEMPLATE_NOTIFICATION_KEYS = {
  APPROVAL: 'approval',
  SCHEDULE: 'schedule',
  DAILY_REPORT: 'dailyReport',
} as const;

export type TemplateNotificationKey = typeof TEMPLATE_NOTIFICATION_KEYS[keyof typeof TEMPLATE_NOTIFICATION_KEYS];

export type TemplateNotificationSetting = {
  key: TemplateNotificationKey;
  title: string;
  description: string;
  templateId: string;
};

export const TEMPLATE_NOTIFICATION_IDS = {
  approval: 'y8MwNsRAIxVW7lA2pj6dngYy17wTBV7Csi-HiKdb-yM',
  schedule: 'khfn6xBUWBIPH96yrhPuTDz0Zobjn870BmSd0GzK-Uw',
  dailyReport: 'haGTkHlfvzHxdSQtl0m8pD89YeGps4R4kRLJ6mHLYhs',
} as const;

/**
 * The single registry for WeChat template notifications shown in the miniapp.
 * Add future template types here so their switches and authorization entry
 * appear automatically in the message center.
 */
export function templateNotificationCatalog(): TemplateNotificationSetting[] {
  return [
    {
      key: TEMPLATE_NOTIFICATION_KEYS.APPROVAL,
      title: '审批与资料修改',
      description: '入职、离职、转店、调薪、资料修改等流程提醒',
      templateId: process.env.HR_APPROVAL_TEMPLATE_ID?.trim() || TEMPLATE_NOTIFICATION_IDS.approval,
    },
    {
      key: TEMPLATE_NOTIFICATION_KEYS.SCHEDULE,
      title: '排班调整通知',
      description: '接收本人排班发布和已发布班次的调整提醒',
      templateId: process.env.HR_SCHEDULE_TEMPLATE_ID?.trim() || TEMPLATE_NOTIFICATION_IDS.schedule,
    },
    {
      key: TEMPLATE_NOTIFICATION_KEYS.DAILY_REPORT,
      title: '门店填报提醒',
      description: '每日经营数据填报和提醒转派通知',
      templateId: TEMPLATE_NOTIFICATION_IDS.dailyReport,
    },
  ];
}

export function isTemplateNotificationEnabled(preferences: unknown, key: TemplateNotificationKey) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return true;
  return (preferences as Record<string, unknown>)[key] !== false;
}

export function notificationPreferenceMap(preferences: unknown): Record<string, boolean> {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return {};
  return Object.fromEntries(Object.entries(preferences as Record<string, unknown>)
    .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
}
