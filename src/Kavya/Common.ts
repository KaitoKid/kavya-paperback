import {
	Request,
	RequestManager,
	Response,
	SourceInterceptor,
	SourceStateManager,
	Tag,
	TagSection
} from '@paperback/types'
import {
	KavitaLibrary,
	SectionInfo,
	describeConnection,
	filterMangaLibraries,
	mapDashboardStreams,
	seriesTitles
} from './Kavita'

const KAVITA_PUBLICATION_STATUS: any = {
	0: 'Ongoing',
	1: 'Hiatus',
	2: 'Completed',
	3: 'Cancelled',
	4: 'Ended',
}

// Kavita issues JWTs valid for 3 days; refresh well before that
const TOKEN_MAX_AGE = 48 * 60 * 60 * 1000

// /Library/libraries is memoised so paging and view-more do not refetch it every time
const LIBRARY_CACHE_MAX_AGE = 10 * 60 * 1000

//
// Kavya Common Class & Methods
//
export class KavitaRequestInterceptor implements SourceInterceptor {
	stateManager: SourceStateManager
	authorization: string
	authorizedAt: number
	pendingAuthorization?: Promise<string>

	constructor(stateManager: SourceStateManager) {
		this.stateManager = stateManager
		this.authorization = ''
		this.authorizedAt = 0
	}

	async isServerAvailable(): Promise<boolean> {
		return (await this.getAuthorizationString()).startsWith('Bearer ')
	}

	async getAuthorizationString(): Promise<string> {
		if (this.authorization === '' || Date.now() - this.authorizedAt > TOKEN_MAX_AGE) {
			// Share one authenticate call between requests that arrive at the same time
			if (this.pendingAuthorization === undefined) {
				this.pendingAuthorization = getAuthorization(this.stateManager).then((authorization) => {
					this.authorization = authorization
					this.authorizedAt = Date.now()
					return authorization
				}).finally(() => {
					this.pendingAuthorization = undefined
				})
			}
			return await this.pendingAuthorization
		}

		return this.authorization
	}

	clearAuthorizationString(): void {
		this.authorization = ''
		this.authorizedAt = 0
	}

	async interceptResponse(response: Response): Promise<Response> {
		// The JWT expired or was revoked: the next request authenticates again
		if (response.status === 401) this.clearAuthorizationString()
		return response
	}

	async interceptRequest(request: Request): Promise<Request> {
		request.headers = {
			...request.headers,
			...(typeof request.data === 'string' ? { 'Content-Type': 'application/json' } : {}),

			'Authorization': await this.getAuthorizationString()
		}

		if (request.url.startsWith('FAKE*')) {
			request.url = request.url.split('*REAL*').pop() ?? ''
		}

		return request
	}
}

export function getServerUnavailableMangaTiles() {
	// This tile is used as a placeholder when the server is unavailable
	return [
		App.createPartialSourceManga({
			title: 'Server',
			image: '',
			mangaId: 'placeholder-id',
			subtitle: 'unavailable',
		}),
	]
}

export async function getSeriesDetails(mangaId: string, requestManager: RequestManager, stateManager: SourceStateManager) {
	const kavitaAPI = await getKavitaAPI(stateManager)

	const seriesRequest = App.createRequest({
		url: `${kavitaAPI.url}/Series/${mangaId}`,
		method: 'GET',
	})
	const metadataRequest = App.createRequest({
		url: `${kavitaAPI.url}/Series/metadata`,
		param: `?seriesId=${mangaId}`,
		method: 'GET',
	})

	const promises: Promise<Response>[] = []

	promises.push(requestManager.schedule(seriesRequest, 1))
	promises.push(requestManager.schedule(metadataRequest, 1))

	const responses: Response[] = await Promise.all(promises)

	const seriesResult = parseJSON(responses[0], {})
	const metadataResult = parseJSON(responses[1], {})

	// exclude people tags for now
	const tagNames = ['genres', 'tags']
	const tagSections: TagSection[] = []

	for (const tagName of tagNames) {
		const tags: Tag[] = []

		for (const tag of metadataResult[tagName] ?? []) {
			tags.push(App.createTag({
				id: `${tagName}-${tag.id}`,
				label: tag.title
			}))
		}

		tagSections.push(App.createTagSection({
			id: tagName,
			label: tagName,
			tags: tags
		}))
	}

	const artists = []
	for (const penciller of metadataResult.pencillers ?? []) {
		artists.push(penciller.name)
	}

	const authors = []
	for (const writer of metadataResult.writers ?? []) {
		authors.push(writer.name)
	}

	return {
		image: `${kavitaAPI.url}/image/series-cover?seriesId=${mangaId}&apiKey=${kavitaAPI.key}`,
		artist: artists.join(', '),
		author: authors.join(', '),
		desc: (metadataResult.summary ?? '').replace(/<[^>]+>/g, ''),
		status: KAVITA_PUBLICATION_STATUS[metadataResult.publicationStatus] ?? 'Unknown',
		hentai: false,
		titles: seriesTitles(seriesResult),
		rating: seriesResult.userRating,
		tags: tagSections,
		//additionalInfo: Record<string, string>
	}
}

export function parseJSON(response: Response | undefined, fallback: any): any {
	if (typeof response?.data !== 'string' || response.data === '') return fallback
	try {
		return JSON.parse(response.data)
	} catch (error) {
		return fallback
	}
}

// The only cache in Kavya: the manga library list, keyed by API url and cleared when the address or key changes
let libraryCache: { url: string, fetchedAt: number, libraries: KavitaLibrary[] } | undefined

export function clearLibraryCache(): void {
	libraryCache = undefined
}

// Libraries this extension shows: Manga, Comic, Image and ComicVine (Book and LightNovel are always hidden)
export async function getMangaLibraries(requestManager: RequestManager, stateManager: SourceStateManager): Promise<KavitaLibrary[]> {
	const kavitaAPI = await getKavitaAPI(stateManager)

	if (libraryCache !== undefined && libraryCache.url === kavitaAPI.url && Date.now() - libraryCache.fetchedAt < LIBRARY_CACHE_MAX_AGE) {
		return libraryCache.libraries
	}

	const request = App.createRequest({
		url: `${kavitaAPI.url}/Library/libraries`,
		method: 'GET'
	})

	const response = await requestManager.schedule(request, 1)
	const result = parseJSON(response, undefined)
	const libraries = filterMangaLibraries(result)

	// Failed requests are not memoised
	if (response.status < 400 && Array.isArray(result)) {
		libraryCache = { url: kavitaAPI.url, fetchedAt: Date.now(), libraries: libraries }
	}

	return libraries
}

// Home sections for the user's Kavita dashboard streams (visible ones, in dashboard order)
export async function getDashboardSections(requestManager: RequestManager, stateManager: SourceStateManager): Promise<SectionInfo[]> {
	const kavitaAPI = await getKavitaAPI(stateManager)

	try {
		const response = await requestManager.schedule(App.createRequest({
			url: `${kavitaAPI.url}/Stream/dashboard`,
			param: '?visibleOnly=true',
			method: 'GET'
		}), 1)

		// Falls back to the built-in streams when the call fails or returns nothing
		return mapDashboardStreams(response.status < 400 ? parseJSON(response, []) : [])
	} catch (error) {
		return mapDashboardStreams([])
	}
}

// Decodes a smart filter into a SeriesFilterV2Dto that can be posted unchanged to /Series/v2
export async function decodeSmartFilter(encodedFilter: string, requestManager: RequestManager, stateManager: SourceStateManager): Promise<any | undefined> {
	const kavitaAPI = await getKavitaAPI(stateManager)

	const response = await requestManager.schedule(App.createRequest({
		url: `${kavitaAPI.url}/Filter/decode`,
		data: JSON.stringify({ encodedFilter: encodedFilter }),
		method: 'POST'
	}), 1)

	const result = parseJSON(response, undefined)
	return response.status < 400 && result !== null && typeof result === 'object' && Array.isArray(result.statements) ? result : undefined
}

export function seriesTile(kavitaAPI: {url: string, key: string}, seriesId: number, title: string) {
	return App.createPartialSourceManga({
		title: title,
		image: `${kavitaAPI.url}/image/series-cover?seriesId=${seriesId}&apiKey=${kavitaAPI.key}`,
		mangaId: `${seriesId}`,
		subtitle: undefined
	})
}

//
// Kavya Setting State Methods
//
export const DEFAULT_VALUES: any = {
	kavitaAddress: 'https://demo.kavitareader.com',
	kavitaAPIUrl: 'https://demo.kavitareader.com/api',
	kavitaAPIKey: '',
	pageSize: 40
}

export async function getKavitaAPI(stateManager: SourceStateManager): Promise<{url: string, key: string}> {
	const kavitaAPIUrl = (await stateManager.retrieve('kavitaAPIUrl') as string | undefined) ?? DEFAULT_VALUES.kavitaAPIUrl
	const kavitaAPIKey = (await stateManager.keychain.retrieve('kavitaAPIKey') as string | undefined) ?? DEFAULT_VALUES.kavitaAPIKey

	return {url: kavitaAPIUrl, key: kavitaAPIKey}
}

function authenticateRequest(kavitaAPI: {url: string, key: string}) {
	return App.createRequest({
		url: `${kavitaAPI.url}/Plugin/authenticate`,
		param: `?apiKey=${kavitaAPI.key}&pluginName=Kavya`,
		method: 'POST'
	})
}

export async function getAuthorization(stateManager: SourceStateManager): Promise<string> {
	const kavitaAPI = await getKavitaAPI(stateManager)
	const manager = App.createRequestManager({
		requestsPerSecond: 8,
		requestTimeout: 20000
	})
	try {
		const response = await manager.schedule(authenticateRequest(kavitaAPI), 1)
		const token = parseJSON(response, {})?.token

		return typeof token === 'string' && token !== '' ? `Bearer ${token}` : ''
	} catch (error) {
		// Unreachable server: callers treat an empty string as "server unavailable"
		return ''
	}
}

// Dedicated manager for the settings status row, so an unreachable server answers within 5 seconds
let connectionManager: RequestManager | undefined

// One status line for the settings page; never includes the API key
export async function getConnectionStatus(stateManager: SourceStateManager): Promise<string> {
	const kavitaAPI = await getKavitaAPI(stateManager)
	if (kavitaAPI.key.trim() === '') return describeConnection({ apiKeyEmpty: true })

	if (connectionManager === undefined) {
		connectionManager = App.createRequestManager({
			requestsPerSecond: 4,
			requestTimeout: 5000
		})
	}

	try {
		const response = await connectionManager.schedule(authenticateRequest(kavitaAPI), 0)
		return describeConnection({ status: response.status, body: parseJSON(response, undefined) })
	} catch (error) {
		return describeConnection({ status: undefined })
	}
}

export async function getOptions(stateManager: SourceStateManager): Promise<{ pageSize: number }> {
	const pageSize = (await stateManager.retrieve('pageSize') as number) ?? DEFAULT_VALUES.pageSize

	return { pageSize }
}
