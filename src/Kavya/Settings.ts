import {
	DUINavigationButton,
	SourceStateManager,
} from '@paperback/types'
import {
	DEFAULT_VALUES,
	KavitaRequestInterceptor,
	clearLibraryCache,
	getConnectionStatus
} from './Common'
import {
	apiUrlFor,
	normaliseServerAddress
} from './Kavita'

/* UI definition */
// NOTE: Submitted data won't be tested
export const serverSettingsMenu = (
	stateManager: SourceStateManager,
	interceptor: KavitaRequestInterceptor
): DUINavigationButton => {
	return App.createDUINavigationButton({
		id: 'server_settings',
		label: 'Server Settings',
		form: App.createDUIForm({
			sections: async () => [
				App.createDUISection({
					id: 'connection',
					header: 'Connection',
					isHidden: false,
					rows: async () => [
						App.createDUILabel({
							id: 'connectionStatus',
							label: 'Status',
							value: await getConnectionStatus(stateManager)
						})
					]
				}),
				App.createDUISection({
					id: 'serverSettings',
					header: 'Server Settings',
					isHidden: false,
					rows: async () => retrieveStateData(stateManager).then((values) => [
						App.createDUIInputField({
							id: 'kavitaAddress',
							label: 'Server URL',
							value: App.createDUIBinding({
								async get() {
									return values.kavitaAddress
								},
								async set(value) {
									values.kavitaAddress = normaliseServerAddress(value) || DEFAULT_VALUES.kavitaAddress
									await setStateData(stateManager, interceptor, values)
								}
							})
						}),
						App.createDUISecureInputField({
							id: 'kavitaAPIKey',
							label: 'API Key',
							value: App.createDUIBinding({
								async get() {
									return values.kavitaAPIKey
								},
								async set(newValue) {
									values.kavitaAPIKey = newValue
									await setStateData(stateManager, interceptor, values)
								}
							})
						}),
						App.createDUIInputField({
							id: 'pageSize',
							label: 'Page Size',
							value: App.createDUIBinding({
								async get() {
									return typeof values.pageSize === 'string' ? values.pageSize : values.pageSize.toString()
								},
								async set(value) {
									values.pageSize = value
									await setStateData(stateManager, interceptor, values)
								}
							})
						})
					]),
				}),
			],
		}),
	})
}

export async function retrieveStateData(stateManager: SourceStateManager) {
	const kavitaAddress = (await stateManager.retrieve('kavitaAddress') as string) ?? DEFAULT_VALUES.kavitaAddress
	const kavitaAPIKey = (await stateManager.keychain.retrieve('kavitaAPIKey') as string) ?? DEFAULT_VALUES.kavitaAPIKey
	const pageSize = (await stateManager.retrieve('pageSize') as number) ?? DEFAULT_VALUES.pageSize

	return { kavitaAddress, kavitaAPIKey, pageSize }
}

export async function setStateData(stateManager: SourceStateManager, interceptor: KavitaRequestInterceptor, data: Record<string, any>) {
	const promises: Promise<void>[] = []
	const prevStateData: any = await retrieveStateData(stateManager)

	let clear = false
	for (const [key, value] of Object.entries(data)) {
		if (prevStateData[key] !== value) {
			switch (key) {
				case 'kavitaAddress': {
					const address = normaliseServerAddress(value) || DEFAULT_VALUES.kavitaAddress
					promises.push(stateManager.store(key, address))
					promises.push(stateManager.store('kavitaAPIUrl', apiUrlFor(address)))
					clear = true
					break
				}
				case 'kavitaAPIKey':
					promises.push(stateManager.keychain.store(key, value))
					clear = true
					break
				case 'pageSize': {
					const parsed = typeof value === 'string' ? parseInt(value) : NaN
					promises.push(stateManager.store(key, isNaN(parsed) || parsed <= 0 ? DEFAULT_VALUES.pageSize : parsed))
					break
				}
			}
		}
	}

	await Promise.all(promises)
	if (clear) {
		interceptor.clearAuthorizationString()
		clearLibraryCache()
	}
}