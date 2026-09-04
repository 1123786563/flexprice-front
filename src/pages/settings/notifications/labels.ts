import type { OmNotificationEvent, OmRuleType } from '@/api/NotificationApi';

// Rule/event types contain dots, which i18next treats as nesting separators —
// keep flat label keys mapped per discriminant instead.
export const RULE_TYPE_LABEL_KEYS: Record<OmRuleType, string> = {
	'entitlements.balance.threshold': 'notifications.types.balanceThreshold',
	'entitlements.reset': 'notifications.types.entitlementsReset',
	'invoice.created': 'notifications.types.invoiceCreated',
	'invoice.updated': 'notifications.types.invoiceUpdated',
};

export const ruleTypeLabelKey = (type: OmRuleType): string => RULE_TYPE_LABEL_KEYS[type];

export const eventTypeLabelKey = (event: OmNotificationEvent): string => RULE_TYPE_LABEL_KEYS[event.type];
