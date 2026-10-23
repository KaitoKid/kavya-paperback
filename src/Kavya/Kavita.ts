//
// Pure Kavita helpers: no `App` usage and no I/O.
// Functions take parsed Kavita JSON and return plain objects, so they can be unit tested.
//

// LibraryType: 0 Manga, 1 Comic, 2 Book, 3 Image, 4 LightNovel, 5 ComicVine
export const MANGA_LIBRARY_TYPES = [0, 1, 3, 5]
// MangaFormat: 3 Epub
export const EPUB_FORMAT = 3

// Kavita parser constants
export const LOOSE_LEAF_VOLUME = -100000
export const SPECIAL_VOLUME = 100000
export const DEFAULT_CHAPTER = -100000

export const FilterField = {
	SeriesName: 1,
	PublicationStatus: 2,
	Tags: 6,
	Genres: 18,
	Libraries: 19,
	ReadProgress: 20
}

export const FilterComparison = {
	Equal: 0,
	GreaterThan: 1,
	LessThan: 3,
	Contains: 5,
	Matches: 7,
	NotContains: 8
}

export const FilterCombination = {
	Or: 0,
	And: 1
}

export const SortField = {
	SortName: 1,
	CreatedDate: 2,
	LastChapterAdded: 4
}

// DashboardStreamDto.streamType
export const StreamType = {
	OnDeck: 1,
	RecentlyUpdated: 2,
	NewlyAdded: 3,
	SmartFilter: 4
}

// FilterEntityType: only Series smart filters can be posted to /Series/v2
export const SERIES_ENTITY_TYPE = 0

// PublicationStatus enum ids, in Kavita order
export const PUBLICATION_STATUSES: { id: number, label: string }[] = [
	{ id: 0, label: 'Ongoing' },
	{ id: 1, label: 'Hiatus' },
	{ id: 2, label: 'Completed' },
	{ id: 3, label: 'Cancelled' },
	{ id: 4, label: 'Ended' }
]

export const READ_PROGRESS_TAGS: { id: string, label: string }[] = [
	{ id: 'unread', label: 'Unread' },
	{ id: 'reading', label: 'In progress' },
	{ id: 'read', label: 'Read' }
]

export interface FilterStatement {
	comparison: number
	field: number
	value: string
}

export interface SeriesFilterV2 {
	statements: FilterStatement[]
	combination: number
	sortOptions: { sortField: number, isAscending: boolean }
	limitTo: number
}

export interface KavitaLibrary {
	id: number
	name: string
	type: number
}

export interface ChapterItem {
	id: string
	chapNum: number
	volume?: number
	name?: string
	group: string
	time: Date
	sortingIndex: number
}

export interface ProgressItem {
	lastReadChapterNumber: number
	lastReadVolumeNumber?: number
	lastReadTime: Date
}

//
// Library & format filters
//
export function filterMangaLibraries(libraries: any[]): KavitaLibrary[] {
	return (Array.isArray(libraries) ? libraries : [])
		.filter((library) => MANGA_LIBRARY_TYPES.includes(library?.type))
		.map((library) => ({ id: library.id, name: library.name, type: library.type }))
}

// Drops Epub series and, when libraryIds is given, series outside those libraries
export function filterSupportedSeries<T extends { format?: number, libraryId?: number }>(series: T[], libraryIds?: number[]): T[] {
	return (Array.isArray(series) ? series : []).filter((item) => {
		if (item?.format === EPUB_FORMAT) return false
		if (libraryIds !== undefined && !libraryIds.includes(item?.libraryId ?? -1)) return false
		return true
	})
}

// Keeps the first occurrence of each id (used for recently-updated, which can repeat series across pages)
export function dedupeBy<T>(items: T[], key: (item: T) => number, seen: number[] = []): T[] {
	const ids = new Set(seen)
	return items.filter((item) => {
		const id = key(item)
		if (ids.has(id)) return false
		ids.add(id)
		return true
	})
}

//
// SeriesFilterV2Dto builders
//
export function buildSeriesFilter(
	statements: FilterStatement[],
	sortField: number = SortField.SortName,
	isAscending = true
): SeriesFilterV2 {
	return {
		statements: statements,
		combination: FilterCombination.And,
		sortOptions: { sortField: sortField, isAscending: isAscending },
		limitTo: 0
	}
}

export function librariesStatement(libraryIds: number[]): FilterStatement {
	return libraryIds.length === 1
		? { comparison: FilterComparison.Equal, field: FilterField.Libraries, value: `${libraryIds[0]}` }
		: { comparison: FilterComparison.Contains, field: FilterField.Libraries, value: libraryIds.join(',') }
}

export function buildLibraryFilter(libraryId: number): SeriesFilterV2 {
	return buildSeriesFilter([librariesStatement([libraryId])], SortField.SortName, true)
}

export function buildRecentlyAddedFilter(libraryIds: number[]): SeriesFilterV2 {
	return buildSeriesFilter([librariesStatement(libraryIds)], SortField.CreatedDate, false)
}

//
// Search
//
export interface SearchTags {
	genres: number[]
	tags: number[]
	statuses: number[]
	progress?: string
}

// Tag ids use the `<group>-<id>` format (genres-4, tags-7, status-2, progress-read); unknown groups are ignored
export function parseTagIds(tagIds?: string[]): SearchTags {
	const parsed: SearchTags = { genres: [], tags: [], statuses: [], progress: undefined }

	for (const tagId of tagIds ?? []) {
		if (typeof tagId !== 'string') continue
		const separator = tagId.indexOf('-')
		if (separator <= 0) continue
		const group = tagId.slice(0, separator)
		const value = tagId.slice(separator + 1)
		const id = /^\d+$/.test(value) ? parseInt(value) : NaN

		switch (group) {
			case 'genres':
				if (!isNaN(id)) parsed.genres.push(id)
				break
			case 'tags':
				if (!isNaN(id)) parsed.tags.push(id)
				break
			case 'status':
				if (PUBLICATION_STATUSES.some((status) => status.id === id) && !parsed.statuses.includes(id)) parsed.statuses.push(id)
				break
			case 'progress':
				// Only the first selected progress tag is used
				if (parsed.progress === undefined && READ_PROGRESS_TAGS.some((tag) => tag.id === value)) parsed.progress = value
				break
		}
	}

	return parsed
}

// ReadProgress is the user's read percentage of the series (0-100, float; Equal uses a 0.001 tolerance)
export function readProgressStatements(progress?: string): FilterStatement[] {
	switch (progress) {
		case 'unread':
			return [{ comparison: FilterComparison.Equal, field: FilterField.ReadProgress, value: '0' }]
		case 'reading':
			return [
				{ comparison: FilterComparison.GreaterThan, field: FilterField.ReadProgress, value: '0' },
				{ comparison: FilterComparison.LessThan, field: FilterField.ReadProgress, value: '100' }
			]
		case 'read':
			return [{ comparison: FilterComparison.Equal, field: FilterField.ReadProgress, value: '100' }]
		default:
			return []
	}
}

// True when the selected tags produce at least one filter statement (excluded status/progress tags are ignored)
export function hasTagFilters(includedTagIds?: string[], excludedTagIds?: string[]): boolean {
	const included = parseTagIds(includedTagIds)
	const excluded = parseTagIds(excludedTagIds)
	return included.genres.length > 0 || included.tags.length > 0 || included.statuses.length > 0 || included.progress !== undefined
		|| excluded.genres.length > 0 || excluded.tags.length > 0
}

// 'search': GET /Search/search (normalised name matching, one page); 'filter': POST /Series/v2 (server paging)
export function chooseSearchMode(title?: string, includedTagIds?: string[], excludedTagIds?: string[]): 'search' | 'filter' {
	const query = (title ?? '').trim()
	return query !== '' && !hasTagFilters(includedTagIds, excludedTagIds) ? 'search' : 'filter'
}

export function buildSearchFilter(libraryIds: number[], title?: string, includedTagIds?: string[], excludedTagIds?: string[]): SeriesFilterV2 {
	const statements: FilterStatement[] = [librariesStatement(libraryIds)]

	const query = (title ?? '').trim()
	if (query !== '') {
		// HasName only supports Equal/NotEqual/BeginsWith/EndsWith/Matches; Matches is LIKE %q% on
		// Name, OriginalName, LocalizedName and SortName
		statements.push({ comparison: FilterComparison.Matches, field: FilterField.SeriesName, value: query })
	}

	const included = parseTagIds(includedTagIds)
	const excluded = parseTagIds(excludedTagIds)

	// Contains = has any of the ids; NotContains = has none of the ids
	if (included.genres.length > 0) {
		statements.push({ comparison: FilterComparison.Contains, field: FilterField.Genres, value: included.genres.join(',') })
	}
	if (included.tags.length > 0) {
		statements.push({ comparison: FilterComparison.Contains, field: FilterField.Tags, value: included.tags.join(',') })
	}
	if (excluded.genres.length > 0) {
		statements.push({ comparison: FilterComparison.NotContains, field: FilterField.Genres, value: excluded.genres.join(',') })
	}
	if (excluded.tags.length > 0) {
		statements.push({ comparison: FilterComparison.NotContains, field: FilterField.Tags, value: excluded.tags.join(',') })
	}
	if (included.statuses.length > 0) {
		statements.push({ comparison: FilterComparison.Contains, field: FilterField.PublicationStatus, value: included.statuses.join(',') })
	}
	statements.push(...readProgressStatements(included.progress))

	return buildSeriesFilter(statements, SortField.SortName, true)
}

// GET /Search/search returns { series: [{ seriesId, name, libraryId, format, ... }], ... }
export function mapTitleSearchResults(result: any, libraryIds: number[]): { seriesId: number, name: string }[] {
	const series: any[] = Array.isArray(result?.series) ? result.series : []
	return filterSupportedSeries(series, libraryIds).map((item) => ({ seriesId: item.seriesId, name: item.name }))
}

//
// Home sections
//
export type SectionKind = 'ondeck' | 'recentlyupdated' | 'newlyadded' | 'smartfilter' | 'library'

export interface SectionInfo {
	id: string
	title: string
	kind: SectionKind
	streamId?: number
	libraryId?: number
	encodedFilter?: string
}

export const DEFAULT_STREAM_SECTIONS: SectionInfo[] = [
	{ id: 'ondeck', title: 'On Deck', kind: 'ondeck' },
	{ id: 'recentlyupdated', title: 'Recently Updated', kind: 'recentlyupdated' },
	{ id: 'newlyadded', title: 'Newly Added', kind: 'newlyadded' }
]

function streamSection(stream: any): SectionInfo | undefined {
	switch (stream?.streamType) {
		case StreamType.OnDeck:
			return { ...DEFAULT_STREAM_SECTIONS[0] } as SectionInfo
		case StreamType.RecentlyUpdated:
			return { ...DEFAULT_STREAM_SECTIONS[1] } as SectionInfo
		case StreamType.NewlyAdded:
			return { ...DEFAULT_STREAM_SECTIONS[2] } as SectionInfo
		case StreamType.SmartFilter: {
			const encoded = stream.smartFilterEncoded
			if (typeof encoded !== 'string' || encoded === '' || typeof stream.id !== 'number') return undefined
			// Reading list, person and annotation smart filters cannot be shown as series
			if ((stream.entityType ?? SERIES_ENTITY_TYPE) !== SERIES_ENTITY_TYPE) return undefined
			const name = typeof stream.name === 'string' && stream.name.trim() !== '' ? stream.name.trim() : 'Smart Filter'
			return { id: `smartfilter-${stream.id}`, title: name, kind: 'smartfilter', streamId: stream.id, encodedFilter: encoded }
		}
		default:
			return undefined
	}
}

// Maps GET /Stream/dashboard to home sections in dashboard order; falls back to the built-in streams when nothing maps
export function mapDashboardStreams(streams: any): SectionInfo[] {
	const visible = (Array.isArray(streams) ? streams : [])
		.filter((stream) => stream !== null && typeof stream === 'object' && stream.visible !== false)
		.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))

	const sections: SectionInfo[] = []
	for (const stream of visible) {
		const section = streamSection(stream)
		if (section !== undefined && !sections.some((item) => item.id === section.id)) sections.push(section)
	}

	return sections.length > 0 ? sections : DEFAULT_STREAM_SECTIONS.map((section) => ({ ...section }))
}

export function librarySections(libraries: KavitaLibrary[]): SectionInfo[] {
	return libraries.map((library) => ({ id: `${library.id}`, title: library.name, kind: 'library', libraryId: library.id }))
}

// Section ids: ondeck, recentlyupdated, newlyadded, smartfilter-<streamId>, <libraryId>
export function parseSectionId(sectionId: string): SectionInfo | undefined {
	const builtIn = DEFAULT_STREAM_SECTIONS.find((section) => section.id === sectionId)
	if (builtIn !== undefined) return { ...builtIn }

	const smartFilter = /^smartfilter-(\d+)$/.exec(sectionId)
	if (smartFilter !== null) return { id: sectionId, title: '', kind: 'smartfilter', streamId: parseInt(smartFilter[1] ?? '') }

	if (/^\d+$/.test(sectionId)) return { id: sectionId, title: '', kind: 'library', libraryId: parseInt(sectionId) }

	return undefined
}

//
// Settings
//
// Trims, adds http:// when no scheme is given, strips trailing slashes and a trailing /api
export function normaliseServerAddress(value: any): string {
	let address = typeof value === 'string' ? value.trim() : ''
	if (address === '') return ''

	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(address)) address = `http://${address}`

	address = address.replace(/\/+$/, '')
	if (/\/api$/i.test(address)) address = address.slice(0, -4).replace(/\/+$/, '')

	return address
}

export function apiUrlFor(address: string): string {
	return `${address}/api`
}

// Result of POST /Plugin/authenticate as a status line; `status` undefined means the request did not complete
export function describeConnection(result: { apiKeyEmpty?: boolean, status?: number, body?: any }): string {
	if (result.apiKeyEmpty === true) return 'Not connected: API key is empty'
	const status = result.status
	if (status === undefined || status === 0) return 'Not connected: server unreachable'
	if (status === 401 || status === 403) return 'Not connected: invalid API key'
	if (status >= 200 && status < 300) {
		const body = result.body
		if (typeof body?.token !== 'string' || body.token === '') return 'Not connected: unexpected response (check the server URL)'
		const version = typeof body.kavitaVersion === 'string' && body.kavitaVersion !== '' ? body.kavitaVersion : '(unknown version)'
		const username = typeof body.username === 'string' && body.username !== '' ? body.username : '(unknown user)'
		return `Connected to Kavita ${version} as ${username}`
	}
	return `Not connected: server returned HTTP ${status}`
}

//
// Series details
//
export function seriesTitles(series: any): string[] {
	const titles: string[] = []
	for (const title of [series?.name, series?.localizedName, series?.originalName]) {
		if (typeof title === 'string' && title.trim() !== '' && !titles.includes(title)) titles.push(title)
	}
	return titles
}

//
// Dates
//
export function parseKavitaDate(value: any, utc = false): Date | undefined {
	if (typeof value !== 'string' || value === '' || value.startsWith('0001-01-01')) return undefined
	const hasTimezone = /([zZ]|[+-]\d\d:?\d\d)$/.test(value)
	const date = new Date(utc && !hasTimezone ? `${value}Z` : value)
	return isNaN(date.getTime()) ? undefined : date
}

function chapterTime(chapter: any): Date {
	return parseKavitaDate(chapter?.releaseDate)
		?? parseKavitaDate(chapter?.createdUtc, true)
		?? parseKavitaDate(chapter?.created)
		?? new Date(0)
}

//
// Chapters
//
interface MappedChapter {
	id: string
	chapNum: number
	volume?: number
	name?: string
	group: string
	time: Date
	special: boolean
	read: boolean
	lastRead: Date
	_index: number
}

// Volume-less chapters sort after numbered volumes, then by chapter number, then by original order
function sortHelper(a: MappedChapter, b: MappedChapter): number {
	if (a.volume !== b.volume) {
		if (a.volume === undefined) return 1
		if (b.volume === undefined) return -1
		return a.volume - b.volume
	}
	return a.chapNum === b.chapNum ? a._index - b._index : a.chapNum - b.chapNum
}

function mapVolumes(volumes: any[]): MappedChapter[] {
	const items: MappedChapter[] = []

	let index = 0
	for (const volume of Array.isArray(volumes) ? volumes : []) {
		const volumeNumber: number = volume?.minNumber
		const isLooseLeaf = volumeNumber === LOOSE_LEAF_VOLUME
		const isSpecialVolume = volumeNumber === SPECIAL_VOLUME

		for (const chapter of volume?.chapters ?? []) {
			const special = chapter.isSpecial === true || isSpecialVolume
			const progress = !chapter.pagesRead ? '' : chapter.pages === chapter.pagesRead ? ' · Read' : ` · Page ${chapter.pagesRead}/${chapter.pages}`

			const item: MappedChapter = {
				id: `${chapter.id}`,
				chapNum: chapter.minNumber,
				volume: isLooseLeaf || isSpecialVolume ? undefined : volumeNumber,
				name: typeof chapter.titleName === 'string' && chapter.titleName.trim() !== '' ? chapter.titleName : undefined,
				group: `${special ? 'Specials · ' : ''}${chapter.pages} pages${progress}`,
				time: chapterTime(chapter),
				special: special,
				read: chapter.pages > 0 && chapter.pagesRead === chapter.pages,
				lastRead: parseKavitaDate(chapter.lastReadingProgressUtc, true) ?? new Date(0),
				_index: index++
			}

			if (special) {
				item.chapNum = 0
				item.volume = undefined
				item.name = typeof chapter.title === 'string' && chapter.title.trim() !== '' ? chapter.title : chapter.range
			} else if (chapter.minNumber === DEFAULT_CHAPTER) {
				// A file that is only a volume (no chapter number)
				item.chapNum = isLooseLeaf ? 0 : volumeNumber
				item.name = isLooseLeaf ? item.name : `Volume ${volumeNumber}`
			}

			items.push(item)
		}
	}

	return items
}

export function mapChapters(volumes: any[]): ChapterItem[] {
	const items = mapVolumes(volumes)
	const chapters = items.filter((item) => !item.special).sort(sortHelper)
	const specials = items.filter((item) => item.special)

	return chapters.concat(specials).map((item, index) => ({
		id: item.id,
		chapNum: item.chapNum,
		volume: item.volume,
		name: item.name,
		group: item.group,
		time: item.time,
		sortingIndex: index
	}))
}

//
// Progress: last chapter of the leading run of fully read chapters (specials skipped)
//
export function mapProgress(volumes: any[]): ProgressItem {
	const chapters = mapVolumes(volumes).filter((item) => !item.special).sort(sortHelper)

	const progress: ProgressItem = { lastReadChapterNumber: 0, lastReadVolumeNumber: undefined, lastReadTime: new Date(0) }
	for (const chapter of chapters) {
		if (!chapter.read) break
		progress.lastReadChapterNumber = chapter.chapNum
		progress.lastReadVolumeNumber = chapter.volume
		progress.lastReadTime = chapter.lastRead
	}

	return progress
}
