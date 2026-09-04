import { ingestUsageEvents } from '@/core/services/openmeter';

type ModelContextNavigator = Navigator & {
	modelContext?: {
		provideContext: (ctx: { tools: unknown[] }) => void;
	};
};

export function registerWebMCPTools() {
	if (typeof navigator === 'undefined') return;
	const nav = navigator as ModelContextNavigator;
	if (!nav.modelContext?.provideContext) return;

	nav.modelContext.provideContext({
		tools: [
			{
				name: 'get_flexprice_app_info',
				description:
					'Returns metadata about the Flexprice dashboard the user is currently viewing: product name, build version, and canonical documentation and API URLs.',
				inputSchema: { type: 'object', properties: {}, additionalProperties: false },
				execute: async () => {
					// Metered as `mcp_calls` in OpenMeter; ingest is fire-and-forget and never throws.
					void ingestUsageEvents([{ type: 'mcp_calls', data: { tool: 'get_flexprice_app_info' } }]);
					return {
						name: 'Flexprice Dashboard',
						version: __APP_VERSION__,
						docs: 'https://docs.flexprice.io',
						api: 'https://api.cloud.flexprice.io',
					};
				},
			},
		],
	});
}
