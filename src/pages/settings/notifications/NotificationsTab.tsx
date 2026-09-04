import { useTranslation } from 'react-i18next';
import ChannelsSection from './ChannelsSection';
import EventsSection from './EventsSection';
import RulesSection from './RulesSection';

const NotificationsTab = () => {
	const { t } = useTranslation('settings');
	return (
		<div className='flex flex-col gap-6'>
			<div className='rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'>
				{t('notifications.ossLimitNotice')}
			</div>
			<ChannelsSection />
			<RulesSection />
			<EventsSection />
		</div>
	);
};

export default NotificationsTab;
