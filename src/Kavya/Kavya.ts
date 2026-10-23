import {
	BadgeColor,
	Chapter,
	ChapterDetails,
	ChapterProviding,
	ContentRating,
	DUIForm,
	DUISection,
	HomePageSectionsProviding,
	HomeSection,
	MangaProgress,
	MangaProgressProviding,
	MangaProviding,
	PagedResults,
	PartialSourceManga,
	RequestManagerProviding,
	SearchRequest,
	SearchResultsProviding,
	SourceInfo,
	SourceIntents,
	SourceManga,
	Tag,
	TagSection,
	TrackerActionQueue
} from '@paperback/types'
import {
	serverSettingsMenu
} from './Settings'
import {
	KavitaRequestInterceptor,
	decodeSmartFilter,
	getDashboardSections,
	getKavitaAPI,
	getMangaLibraries,
	getOptions,
	getSeriesDetails,
	getServerUnavailableMangaTiles,
	parseJSON,
	seriesTile
} from './Common'
import { searchRequest } from './Search'
import {
	PUBLICATION_STATUSES,
	READ_PROGRESS_TAGS,
	SectionInfo,
	buildLibraryFilter,
	buildRecentlyAddedFilter,
	dedupeBy,
	filterSupportedSeries,
	librarySections,
	mapChapters,
	mapProgress,
	parseSectionId
} from './Kavita'

export const KavyaInfo: SourceInfo = {
	version: '2.1.1',
	name: 'Kavya',
	icon: 'icon.png',
	author: 'KaitoKid, ACK72',
	authorWebsite: 'https://github.com/KaitoKid',
	description: 'Kavita client for Paperback (manga and comics only)',
	contentRating: ContentRating.EVERYONE,
	websiteBaseURL: 'https://www.kavitareader.com/',
	sourceTags: [
		{
			text: 'Kavita',
			type: BadgeColor.GREEN,
		},
	],
	intents: SourceIntents.COLLECTION_MANAGEMENT | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.MANGA_CHAPTERS | SourceIntents.MANGA_TRACKING | SourceIntents.SETTINGS_UI
}

interface SectionPage {
	tiles: PartialSourceManga[]
	seriesIds: number[]
	hasMore: boolean
}

export class Kavya implements ChapterProviding, HomePageSectionsProviding, MangaProgressProviding, MangaProviding, RequestManagerProviding, SearchResultsProviding {
	stateManager = App.createSourceStateManager()

	interceptor = new KavitaRequestInterceptor(this.stateManager)

	requestManager = App.createRequestManager({
		requestsPerSecond: 8,
		requestTimeout: 20000,
		interceptor: this.interceptor
	})

	async getSourceMenu(): Promise<DUISection> {
		return App.createDUISection({
			id: 'main',
			header: 'Source Settings',
			isHidden: false,
			rows: async () => [
				serverSettingsMenu(this.stateManager, this.interceptor)
			],
		})
	}

	async getMangaDetails(mangaId: string): Promise<SourceManga> {
		return App.createSourceManga({
			id: mangaId,
			mangaInfo: App.createMangaInfo({
				...(await getSeriesDetails(mangaId, this.requestManager, this.stateManager))
			})
		})
	}

	async getVolumes(mangaId: string): Promise<any[]> {
		const kavitaAPI = await getKavitaAPI(this.stateManager)

		const request = App.createRequest({
			url: `${kavitaAPI.url}/Series/volumes`,
			param: `?seriesId=${mangaId}`,
			method: 'GET',
		})

		const response = await this.requestManager.schedule(request, 1)
		const result = parseJSON(response, [])
		return Array.isArray(result) ? result : []
	}

	async getChapters(mangaId: string): Promise<Chapter[]> {
		const volumes = await this.getVolumes(mangaId)
		return mapChapters(volumes).map((chapter) => App.createChapter(chapter))
	}

	async getChapterDetails(
		mangaId: string,
		chapterId: string
	): Promise<ChapterDetails> {
		const kavitaAPI = await getKavitaAPI(this.stateManager)

		// chapter-info also makes Kavita extract and cache the chapter, so the first page loads faster.
		// extractPdf matches the page image requests below.
		const request = App.createRequest({
			url: `${kavitaAPI.url}/Reader/chapter-info`,
			param: `?chapterId=${chapterId}&extractPdf=true`,
			method: 'GET',
		})

		const response = await this.requestManager.schedule(request, 1)
		const result = parseJSON(response, {})

		const pages: string[] = []
		for (let i = 0;i < (result.pages ?? 0);i++) {
			pages.push(`FAKE*/${i}?*REAL*${kavitaAPI.url}/Reader/image?chapterId=${chapterId}&page=${i}&apiKey=${kavitaAPI.key}&extractPdf=true`)
		}

		return App.createChapterDetails({
			id: chapterId,
			mangaId: mangaId,
			pages: pages
		})
	}

	async getSearchResults(
		searchQuery: SearchRequest,
		metadata: any
	): Promise<PagedResults> {
		return await searchRequest(searchQuery, metadata, this.requestManager, this.interceptor, this.stateManager)
	}

	async getSearchTags(): Promise<TagSection[]> {
		// This function is also called when the user search in an other source. It should not throw if the server is unavailable.
		if (!(await this.interceptor.isServerAvailable())) {
			return []
		}

		const kavitaAPI = await getKavitaAPI(this.stateManager)
		const libraryIds = (await getMangaLibraries(this.requestManager, this.stateManager)).map((library) => library.id)
		if (libraryIds.length === 0) {
			return []
		}

		const tagGroups = [{ id: 'genres', label: 'Genres' }, { id: 'tags', label: 'Tags' }]

		const metadataSections = await Promise.all(tagGroups.map(async (group) => {
			const request = App.createRequest({
				url: `${kavitaAPI.url}/Metadata/${group.id}`,
				param: `?libraryIds=${libraryIds.join(',')}`,
				method: 'GET',
			})

			const response = await this.requestManager.schedule(request, 1)
			const result = parseJSON(response, [])

			const tags: Tag[] = (Array.isArray(result) ? result : []).map((item: any) => App.createTag({
				id: `${group.id}-${item.id}`,
				label: item.title
			}))

			return { group: group, tags: tags }
		}))

		// Genres always, Tags only when the server has any
		const sections: TagSection[] = metadataSections
			.filter((section) => section.group.id !== 'tags' || section.tags.length > 0)
			.map((section) => App.createTagSection({
				id: section.group.id,
				label: section.group.label,
				tags: section.tags
			}))

		sections.push(App.createTagSection({
			id: 'status',
			label: 'Publication status',
			tags: PUBLICATION_STATUSES.map((status) => App.createTag({ id: `status-${status.id}`, label: status.label }))
		}))

		sections.push(App.createTagSection({
			id: 'progress',
			label: 'Read progress',
			tags: READ_PROGRESS_TAGS.map((progress) => App.createTag({ id: `progress-${progress.id}`, label: progress.label }))
		}))

		return sections
	}

	// Fetches one page of a home section. `libraryIds` are the manga libraries; `seen` are series already shown.
	// `filter` is the decoded SeriesFilterV2Dto of a smart filter section.
	async getSectionPage(section: SectionInfo, page: number, pageSize: number, libraryIds: number[], seen: number[] = [], filter?: any): Promise<SectionPage> {
		const kavitaAPI = await getKavitaAPI(this.stateManager)
		const paging = `PageNumber=${page}&PageSize=${pageSize}`

		let apiPath: string, body: any = {}, id = 'id', title = 'name'
		switch (section.kind) {
			case 'ondeck':
				apiPath = `${kavitaAPI.url}/Series/on-deck?${paging}`
				break
			case 'recentlyupdated':
				apiPath = `${kavitaAPI.url}/Series/recently-updated-series?${paging}`
				id = 'seriesId', title = 'seriesName'
				break
			case 'newlyadded':
				apiPath = `${kavitaAPI.url}/Series/recently-added-v2?${paging}`
				body = buildRecentlyAddedFilter(libraryIds)
				break
			case 'smartfilter':
				// Posted unchanged: results are limited to manga libraries client-side below
				if (filter === undefined) return { tiles: [], seriesIds: [], hasMore: false }
				apiPath = `${kavitaAPI.url}/Series/v2?${paging}`
				body = filter
				break
			case 'library':
				apiPath = `${kavitaAPI.url}/Series/v2?${paging}`
				body = buildLibraryFilter(section.libraryId ?? -1)
				break
		}

		const request = App.createRequest({
			url: apiPath,
			data: JSON.stringify(body),
			method: 'POST',
		})

		const response = await this.requestManager.schedule(request, 1)
		const result = parseJSON(response, [])
		const series: any[] = Array.isArray(result) ? result : []

		const supported = dedupeBy(filterSupportedSeries(series, libraryIds), (item: any) => item[id], seen)

		return {
			tiles: supported.map((item: any) => seriesTile(kavitaAPI, item[id], item[title])),
			seriesIds: supported.map((item: any) => item[id]),
			hasMore: series.length >= pageSize
		}
	}

	async getHomePageSections(
		sectionCallback: (section: HomeSection) => void
	): Promise<void> {
		// This function is called on the homepage and should not throw if the server is unavailable
		if (!(await this.interceptor.isServerAvailable())) {
			sectionCallback(
				App.createHomeSection({
					id: 'placeholder-id',
					title: 'Library',
					items: getServerUnavailableMangaTiles(),
					containsMoreItems: false,
					type: 'singleRowNormal'
				})
			)
			return
		}

		const { pageSize } = await getOptions(this.stateManager)
		const sectionSize = Math.max(1, Math.floor(pageSize / 2))

		const libraries = await getMangaLibraries(this.requestManager, this.stateManager)
		const libraryIds = libraries.map((library) => library.id)
		if (libraryIds.length === 0) {
			return
		}

		// The Kavita dashboard (in its order, including smart filters), then one section per manga library
		const infos = (await getDashboardSections(this.requestManager, this.stateManager)).concat(librarySections(libraries))

		const sections = infos.map((info) => App.createHomeSection({
			id: info.id,
			title: info.title,
			containsMoreItems: false,
			type: 'singleRowNormal'
		}))

		for (const section of sections) {
			sectionCallback(section)
		}

		// Make sure the function completes
		await Promise.all(infos.map(async (info, index) => {
			const section = sections[index]
			if (section === undefined) return

			try {
				const filter = info.kind === 'smartfilter' && info.encodedFilter !== undefined
					? await decodeSmartFilter(info.encodedFilter, this.requestManager, this.stateManager)
					: undefined
				const result = await this.getSectionPage(info, 1, sectionSize, libraryIds, [], filter)

				section.items = result.tiles
				section.containsMoreItems = result.hasMore
			} catch (error) {
				// One failing section should not hide the others
				section.items = []
				section.containsMoreItems = false
			}
			sectionCallback(section)
		}))
	}

	// Finds a smart filter stream on the dashboard and decodes it
	async getSmartFilter(streamId: number): Promise<any | undefined> {
		const stream = (await getDashboardSections(this.requestManager, this.stateManager))
			.find((section) => section.kind === 'smartfilter' && section.streamId === streamId)
		if (stream?.encodedFilter === undefined) return undefined
		return await decodeSmartFilter(stream.encodedFilter, this.requestManager, this.stateManager)
	}

	async getViewMoreItems(
		homepageSectionId: string,
		metadata: any
	): Promise<PagedResults> {
		const { pageSize } = await getOptions(this.stateManager)
		const page: number = metadata?.page ?? 1
		const seen: number[] = metadata?.seen ?? []

		const section = parseSectionId(homepageSectionId)
		if (section === undefined) {
			return App.createPagedResults({ results: [] })
		}

		const libraryIds = (await getMangaLibraries(this.requestManager, this.stateManager)).map((library) => library.id)
		if (libraryIds.length === 0) {
			return App.createPagedResults({ results: [] })
		}

		// The decoded smart filter is plain JSON, so it is carried in metadata instead of decoding it again per page
		const filter = section.kind === 'smartfilter'
			? metadata?.filter ?? await this.getSmartFilter(section.streamId ?? -1)
			: undefined

		const result = await this.getSectionPage(section, page, pageSize, libraryIds, seen, filter)

		return App.createPagedResults({
			results: result.tiles,
			metadata: result.hasMore ? {
				page: page + 1,
				seen: section.kind === 'recentlyupdated' ? seen.concat(result.seriesIds) : [],
				...(filter !== undefined ? { filter: filter } : {})
			} : undefined
		})
	}

	async getMangaProgress(mangaId: string): Promise<MangaProgress | undefined> {
		const progress = mapProgress(await this.getVolumes(mangaId))

		return App.createMangaProgress({
			mangaId: mangaId,
			lastReadChapterNumber: progress.lastReadChapterNumber,
			lastReadVolumeNumber: progress.lastReadVolumeNumber,
			trackedListName: 'Kavita',
			lastReadTime: progress.lastReadTime
		})
	}

	async getMangaProgressManagementForm(mangaId: string): Promise<DUIForm> {
		let rating: number | undefined

		return App.createDUIForm({
			sections: async () => {
				const kavitaAPI = await getKavitaAPI(this.stateManager)

				const request = App.createRequest({
					url: `${kavitaAPI.url}/Series/${mangaId}`,
					method: 'GET',
				})
				const response = await this.requestManager.schedule(request, 1)
				const result = parseJSON(response, {})

				return [
					App.createDUISection({
						id: 'seriesInfo',
						header: 'Info',
						isHidden: false,
						rows: async () => [
							App.createDUILabel({
								id: 'seriesId',
								label: 'SeriesID',
								value: mangaId
							}),
							App.createDUILabel({
								id: 'libraryId',
								label: 'LibraryID',
								value: `${result.libraryId}`
							}),
							App.createDUILabel({
								id: 'pagesRead',
								label: 'Pages Read',
								value: `${result.pagesRead} / ${result.pages}`
							})
						]
					}),
					App.createDUISection({
						id: 'userRating',
						header: 'Rating',
						isHidden: false,
						rows: async () => [
							App.createDUIStepper({
								id: 'rating',
								label: 'Rating',
								value: App.createDUIBinding({
									async get() {
										return rating ?? result.userRating ?? 0
									},
									async set(value) {
										rating = value
									}
								}),
								min: 0,
								max: 5,
								step: 1
							})
						]
					})
				]
			},
			onSubmit: async (values) => {
				const userRating = Number(rating ?? values?.rating)
				if (isNaN(userRating)) return

				const kavitaAPI = await getKavitaAPI(this.stateManager)

				await this.requestManager.schedule(App.createRequest({
					url: `${kavitaAPI.url}/Rating/series`,
					data: JSON.stringify({ seriesId: parseInt(mangaId), userRating: userRating }),
					method: 'POST'
				}), 1)
			}
		})
	}

	async processChapterReadActionQueue(actionQueue: TrackerActionQueue): Promise<void> {
		const chapterReadActions = await actionQueue.queuedChapterReadActions()
		const kavitaAPI = await getKavitaAPI(this.stateManager)

		for (const readAction of chapterReadActions) {
			if (!(await this.interceptor.isServerAvailable())) {
				await actionQueue.retryChapterReadAction(readAction)
				continue
			}

			try {
				const chapterRequest = App.createRequest({
					url: `${kavitaAPI.url}/Reader/chapter-info`,
					param: `?chapterId=${readAction.sourceChapterId}`,
					method: 'GET',
				})

				const chapterResponse = await this.requestManager.schedule(chapterRequest, 1)
				const chapterResult = parseJSON(chapterResponse, {})

				const progressRequest = App.createRequest({
					url: `${kavitaAPI.url}/Reader/progress`,
					data: JSON.stringify({
						volumeId: chapterResult.volumeId,
						chapterId: parseInt(readAction.sourceChapterId),
						pageNum: chapterResult.pages,
						seriesId: chapterResult.seriesId,
						libraryId: chapterResult.libraryId
					}),
					method: 'POST',
				})

				const progressResponse = await this.requestManager.schedule(progressRequest, 1)

				if (progressResponse.status < 400) {
					await actionQueue.discardChapterReadAction(readAction)
				} else {
					await actionQueue.retryChapterReadAction(readAction)
				}
			} catch (error) {
				await actionQueue.retryChapterReadAction(readAction)
			}
		}
	}
}
