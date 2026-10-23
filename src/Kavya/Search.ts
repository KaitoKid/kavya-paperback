import {
	PagedResults,
	RequestManager,
	SearchRequest,
	SourceStateManager
} from '@paperback/types'
import {
	KavitaRequestInterceptor,
	getKavitaAPI,
	getMangaLibraries,
	getOptions,
	getServerUnavailableMangaTiles,
	parseJSON,
	seriesTile
} from './Common'
import {
	buildSearchFilter,
	chooseSearchMode,
	filterSupportedSeries,
	mapTitleSearchResults
} from './Kavita'

export async function searchRequest(
	searchQuery: SearchRequest,
	metadata: any,
	requestManager: RequestManager,
	interceptor: KavitaRequestInterceptor,
	stateManager: SourceStateManager
): Promise<PagedResults> {
	// This function is also called when the user search in an other source. It should not throw if the server is unavailable.
	if (!(await interceptor.isServerAvailable())) {
		return App.createPagedResults({
			results: getServerUnavailableMangaTiles(),
		})
	}

	const kavitaAPI = await getKavitaAPI(stateManager)
	const { pageSize } = await getOptions(stateManager)
	const page: number = metadata?.page ?? 1

	const libraryIds = (await getMangaLibraries(requestManager, stateManager)).map((library) => library.id)
	if (libraryIds.length === 0) {
		return App.createPagedResults({ results: [] })
	}

	const includedTagIds = (searchQuery.includedTags ?? []).map((tag) => tag.id)
	const excludedTagIds = (searchQuery.excludedTags ?? []).map((tag) => tag.id)

	// Title only: Kavita's own search matches normalised names ("zom100" finds "Zom 100"), in one page
	if (chooseSearchMode(searchQuery.title, includedTagIds, excludedTagIds) === 'search') {
		const request = App.createRequest({
			url: `${kavitaAPI.url}/Search/search`,
			param: `?queryString=${encodeURIComponent((searchQuery.title ?? '').trim())}&includeChapterAndFiles=false`,
			method: 'GET'
		})

		const response = await requestManager.schedule(request, 1)
		const tiles = mapTitleSearchResults(parseJSON(response, {}), libraryIds).map((item) => seriesTile(kavitaAPI, item.seriesId, item.name))

		return App.createPagedResults({ results: tiles })
	}

	// Tags selected (or no title): /Series/v2 with server paging
	const body = buildSearchFilter(libraryIds, searchQuery.title, includedTagIds, excludedTagIds)

	const request = App.createRequest({
		url: `${kavitaAPI.url}/Series/v2?PageNumber=${page}&PageSize=${pageSize}`,
		data: JSON.stringify(body),
		method: 'POST'
	})

	const response = await requestManager.schedule(request, 1)
	const result = parseJSON(response, [])
	const series: any[] = Array.isArray(result) ? result : []

	const tiles = filterSupportedSeries(series, libraryIds).map((item) => seriesTile(kavitaAPI, item.id, item.name))

	return App.createPagedResults({
		results: tiles,
		metadata: series.length < pageSize ? undefined : { page: page + 1 }
	})
}
