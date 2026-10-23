import { strict as assert } from 'assert'
import {
	apiUrlFor,
	buildLibraryFilter,
	buildRecentlyAddedFilter,
	buildSearchFilter,
	chooseSearchMode,
	dedupeBy,
	describeConnection,
	filterMangaLibraries,
	filterSupportedSeries,
	librarySections,
	mapChapters,
	mapDashboardStreams,
	mapProgress,
	mapTitleSearchResults,
	normaliseServerAddress,
	parseKavitaDate,
	parseSectionId,
	parseTagIds,
	seriesTitles
} from './Kavita'

// mocha globals (no @types/mocha in devDependencies)
declare function describe(name: string, fn: () => void): void
declare function it(name: string, fn: () => void): void

function chapter(fields: Record<string, any>): Record<string, any> {
	return {
		id: 1,
		range: '1',
		number: '1',
		minNumber: 1,
		maxNumber: 1,
		pages: 20,
		pagesRead: 0,
		isSpecial: false,
		title: '',
		titleName: '',
		releaseDate: '0001-01-01T00:00:00',
		created: '2024-01-02T03:04:05',
		createdUtc: '2024-01-02T03:04:05',
		lastReadingProgressUtc: '0001-01-01T00:00:00',
		files: [{ format: 1 }],
		...fields
	}
}

const LOOSE_LEAF = { id: 10, name: '-100000', minNumber: -100000, maxNumber: -100000 }
const SPECIALS = { id: 11, name: '100000', minNumber: 100000, maxNumber: 100000 }

describe('mapChapters', () => {
	it('maps loose-leaf chapters without a volume', () => {
		const chapters = mapChapters([{
			...LOOSE_LEAF,
			chapters: [
				chapter({ id: 2, minNumber: 2, range: '2', title: '2', titleName: 'Second' }),
				chapter({ id: 1, minNumber: 1, range: '1', title: '1', pagesRead: 20 }),
				chapter({ id: 3, minNumber: 2.5, range: '2.5', pagesRead: 5 })
			]
		}])

		assert.deepEqual(chapters.map((c) => [c.id, c.chapNum, c.volume, c.name, c.sortingIndex]), [
			['1', 1, undefined, undefined, 0],
			['2', 2, undefined, 'Second', 1],
			['3', 2.5, undefined, undefined, 2]
		])
		assert.equal(chapters[0]?.group, '20 pages · Read')
		assert.equal(chapters[1]?.group, '20 pages')
		assert.equal(chapters[2]?.group, '20 pages · Page 5/20')
		// releaseDate sentinel falls back to createdUtc, read as UTC
		assert.equal(chapters[0]?.time.toISOString(), '2024-01-02T03:04:05.000Z')
	})

	it('maps numbered volumes and sorts volume-less chapters after them', () => {
		const chapters = mapChapters([
			{ ...LOOSE_LEAF, chapters: [chapter({ id: 30, minNumber: 30 })] },
			{ id: 2, name: '2', minNumber: 2, maxNumber: 2, chapters: [chapter({ id: 20, minNumber: 11 }), chapter({ id: 21, minNumber: 10, releaseDate: '2020-05-06T00:00:00Z' })] },
			{ id: 1, name: '1', minNumber: 1, maxNumber: 1, chapters: [chapter({ id: 10, minNumber: 1 })] }
		])

		assert.deepEqual(chapters.map((c) => [c.id, c.volume, c.chapNum, c.sortingIndex]), [
			['10', 1, 1, 0],
			['21', 2, 10, 1],
			['20', 2, 11, 2],
			['30', undefined, 30, 3]
		])
		assert.equal(chapters[1]?.time.toISOString(), '2020-05-06T00:00:00.000Z')
	})

	it('maps a volume-only file to the volume number', () => {
		const chapters = mapChapters([{
			id: 3, name: '3', minNumber: 3, maxNumber: 3,
			chapters: [chapter({ id: 40, minNumber: -100000, maxNumber: -100000, range: '-100000', number: '-100000', title: '-100000' })]
		}])

		assert.equal(chapters.length, 1)
		assert.equal(chapters[0]?.chapNum, 3)
		assert.equal(chapters[0]?.volume, 3)
		assert.equal(chapters[0]?.name, 'Volume 3')
	})

	it('puts specials last with chapNum 0 and no volume', () => {
		const chapters = mapChapters([
			{ ...SPECIALS, chapters: [chapter({ id: 50, isSpecial: true, minNumber: 0, title: 'Omake', range: 'Series SP01' }), chapter({ id: 51, isSpecial: true, minNumber: 0, range: 'Series SP02' })] },
			{ id: 1, name: '1', minNumber: 1, maxNumber: 1, chapters: [chapter({ id: 10, minNumber: 1 })] }
		])

		assert.deepEqual(chapters.map((c) => [c.id, c.chapNum, c.volume, c.name, c.sortingIndex]), [
			['10', 1, 1, undefined, 0],
			['50', 0, undefined, 'Omake', 1],
			['51', 0, undefined, 'Series SP02', 2]
		])
		assert.equal(chapters[1]?.group, 'Specials · 20 pages')
	})

	it('shows read and partial progress in the group text, also for specials', () => {
		const chapters = mapChapters([
			{ ...SPECIALS, chapters: [chapter({ id: 50, isSpecial: true, minNumber: 0, title: 'Omake', pages: 12, pagesRead: 3 })] },
			{ id: 1, name: '1', minNumber: 1, maxNumber: 1, chapters: [chapter({ id: 10, minNumber: 1, pages: 30, pagesRead: 30 })] }
		])

		assert.deepEqual(chapters.map((c) => c.group), ['30 pages · Read', 'Specials · 12 pages · Page 3/12'])
	})
})

describe('mapProgress', () => {
	it('returns the last chapter of the leading read run and skips specials', () => {
		const progress = mapProgress([
			{ ...SPECIALS, chapters: [chapter({ id: 50, isSpecial: true, pagesRead: 0 })] },
			{ id: 1, name: '1', minNumber: 1, maxNumber: 1, chapters: [
				chapter({ id: 10, minNumber: 1, pagesRead: 20, lastReadingProgressUtc: '2024-03-01T00:00:00' }),
				chapter({ id: 11, minNumber: 2, pagesRead: 20, lastReadingProgressUtc: '2024-03-02T00:00:00' }),
				chapter({ id: 12, minNumber: 3, pagesRead: 4 })
			] }
		])

		assert.equal(progress.lastReadChapterNumber, 2)
		assert.equal(progress.lastReadVolumeNumber, 1)
		assert.equal(progress.lastReadTime.toISOString(), '2024-03-02T00:00:00.000Z')
	})

	it('returns chapter 0 when nothing is read', () => {
		const progress = mapProgress([{ ...LOOSE_LEAF, chapters: [chapter({ id: 1 })] }])
		assert.equal(progress.lastReadChapterNumber, 0)
		assert.equal(progress.lastReadVolumeNumber, undefined)
	})
})

describe('library and format filters', () => {
	it('keeps only Manga, Comic, Image and ComicVine libraries', () => {
		const libraries = filterMangaLibraries([
			{ id: 1, name: 'Manga', type: 0 },
			{ id: 2, name: 'Comics', type: 1 },
			{ id: 3, name: 'Books', type: 2 },
			{ id: 4, name: 'Images', type: 3 },
			{ id: 5, name: 'Novels', type: 4 },
			{ id: 6, name: 'ComicVine', type: 5 }
		])
		assert.deepEqual(libraries.map((library) => library.id), [1, 2, 4, 6])
	})

	it('drops Epub series and series outside the given libraries', () => {
		const series = filterSupportedSeries([
			{ id: 1, libraryId: 1, format: 1 },
			{ id: 2, libraryId: 1, format: 3 },
			{ id: 3, libraryId: 3, format: 4 },
			{ id: 4, libraryId: 2, format: 4 }
		], [1, 2])
		assert.deepEqual(series.map((item) => item.id), [1, 4])
		assert.deepEqual(filterSupportedSeries([{ id: 1, format: 3 }, { id: 2, format: 0 }]).map((item) => item.id), [2])
	})

	it('dedupes by id, including ids seen on earlier pages', () => {
		const items = dedupeBy([{ seriesId: 1 }, { seriesId: 2 }, { seriesId: 1 }, { seriesId: 3 }], (item) => item.seriesId, [3])
		assert.deepEqual(items.map((item) => item.seriesId), [1, 2])
	})
})

describe('SeriesFilterV2Dto builders', () => {
	it('builds a search filter for title and tags', () => {
		assert.deepEqual(buildSearchFilter([1, 3], ' Berserk ', ['genres-4', 'tags-7', 'genres-9', 'people-1.2']), {
			statements: [
				{ comparison: 5, field: 19, value: '1,3' },
				{ comparison: 7, field: 1, value: 'Berserk' },
				{ comparison: 5, field: 18, value: '4,9' },
				{ comparison: 5, field: 6, value: '7' }
			],
			combination: 1,
			sortOptions: { sortField: 1, isAscending: true },
			limitTo: 0
		})
	})

	it('builds a search filter with excluded, status and progress tags', () => {
		const filter = buildSearchFilter(
			[2],
			'',
			['status-2', 'status-4', 'status-9', 'progress-reading', 'progress-read', 'genres-1'],
			['genres-5', 'tags-6', 'tags-8', 'status-0', 'progress-unread', 'unknown-1']
		)
		assert.deepEqual(filter.statements, [
			{ comparison: 0, field: 19, value: '2' },
			{ comparison: 5, field: 18, value: '1' },
			{ comparison: 8, field: 18, value: '5' },
			{ comparison: 8, field: 6, value: '6,8' },
			{ comparison: 5, field: 2, value: '2,4' },
			{ comparison: 1, field: 20, value: '0' },
			{ comparison: 3, field: 20, value: '100' }
		])
	})

	it('maps the unread and read progress tags to ReadProgress percentages', () => {
		assert.deepEqual(buildSearchFilter([1], 'a', ['progress-unread']).statements.slice(2), [{ comparison: 0, field: 20, value: '0' }])
		assert.deepEqual(buildSearchFilter([1], undefined, ['progress-read', 'progress-unread']).statements.slice(1), [{ comparison: 0, field: 20, value: '100' }])
	})

	it('parses tag ids by group and ignores unknown groups and bad ids', () => {
		assert.deepEqual(parseTagIds(['genres-3', 'tags-x', 'people-1', 'status-1', 'status-1', 'progress-bogus', 'progress-read', 'nogroup']), {
			genres: [3],
			tags: [],
			statuses: [1],
			progress: 'read'
		})
	})

	it('builds a search filter with no title and no tags', () => {
		const expected = {
			statements: [{ comparison: 0, field: 19, value: '2' }],
			combination: 1,
			sortOptions: { sortField: 1, isAscending: true },
			limitTo: 0
		}
		assert.deepEqual(buildSearchFilter([2], undefined, undefined), expected)
		assert.deepEqual(buildSearchFilter([2], '', []), expected)
	})

	it('builds library and recently added filters', () => {
		assert.deepEqual(buildLibraryFilter(5).statements, [{ comparison: 0, field: 19, value: '5' }])
		assert.deepEqual(buildRecentlyAddedFilter([1, 2]), {
			statements: [{ comparison: 5, field: 19, value: '1,2' }],
			combination: 1,
			sortOptions: { sortField: 2, isAscending: false },
			limitTo: 0
		})
	})
})

describe('series helpers', () => {
	it('lists name plus distinct localized and original names', () => {
		assert.deepEqual(seriesTitles({ name: 'Frieren', localizedName: 'Sousou no Frieren', originalName: 'Frieren' }), ['Frieren', 'Sousou no Frieren'])
		assert.deepEqual(seriesTitles({ name: 'A', localizedName: '', originalName: null }), ['A'])
	})

	it('treats the 0001-01-01 date as missing', () => {
		assert.equal(parseKavitaDate('0001-01-01T00:00:00'), undefined)
		assert.equal(parseKavitaDate('2024-01-01T00:00:00', true)?.toISOString(), '2024-01-01T00:00:00.000Z')
		assert.equal(parseKavitaDate('2024-01-01T00:00:00+02:00', true)?.toISOString(), '2023-12-31T22:00:00.000Z')
	})
})

describe('search mode', () => {
	it('uses /Search/search for a title without tags', () => {
		assert.equal(chooseSearchMode('zom100', [], []), 'search')
		assert.equal(chooseSearchMode('  zom100 ', undefined, undefined), 'search')
		// Excluded status and progress tags are ignored, so they do not force a filter search
		assert.equal(chooseSearchMode('zom100', [], ['status-1', 'progress-read']), 'search')
		assert.equal(chooseSearchMode('zom100', ['people-1'], []), 'search')
	})

	it('uses /Series/v2 when any tag filter is selected or no title is typed', () => {
		assert.equal(chooseSearchMode('zom100', ['genres-1'], []), 'filter')
		assert.equal(chooseSearchMode('zom100', [], ['tags-2']), 'filter')
		assert.equal(chooseSearchMode('', ['status-0'], []), 'filter')
		assert.equal(chooseSearchMode(undefined, ['progress-unread'], []), 'filter')
		assert.equal(chooseSearchMode('', [], []), 'filter')
	})

	it('keeps Kavita order and drops Epub series and other libraries from /Search/search', () => {
		const results = mapTitleSearchResults({
			series: [
				{ seriesId: 9, name: 'Zom 100', libraryId: 1, format: 1 },
				{ seriesId: 4, name: 'Zom 100 (novel)', libraryId: 1, format: 3 },
				{ seriesId: 7, name: 'Zom 100 Books', libraryId: 5, format: 4 },
				{ seriesId: 2, name: 'Zom 100 Extra', libraryId: 2, format: 4 }
			],
			persons: []
		}, [1, 2])
		assert.deepEqual(results, [{ seriesId: 9, name: 'Zom 100' }, { seriesId: 2, name: 'Zom 100 Extra' }])
		assert.deepEqual(mapTitleSearchResults(undefined, [1]), [])
	})
})

describe('home sections', () => {
	it('maps dashboard streams in order, including smart filters', () => {
		const sections = mapDashboardStreams([
			{ id: 4, name: 'Favourites', order: 2, streamType: 4, smartFilterEncoded: 'stmts=abc', smartFilterId: 1, visible: true, entityType: 0 },
			{ id: 1, name: 'on-deck', order: 3, streamType: 1, visible: true },
			{ id: 2, name: 'recently-updated', order: 0, streamType: 2, visible: true },
			{ id: 3, name: 'newly-added', order: 1, streamType: 3, visible: false },
			{ id: 5, name: 'People', order: 4, streamType: 4, smartFilterEncoded: 'x', entityType: 2, visible: true },
			{ id: 6, name: 'Broken', order: 5, streamType: 4, smartFilterEncoded: '', visible: true },
			{ id: 7, name: 'Future', order: 6, streamType: 9, visible: true }
		])

		assert.deepEqual(sections, [
			{ id: 'recentlyupdated', title: 'Recently Updated', kind: 'recentlyupdated' },
			{ id: 'smartfilter-4', title: 'Favourites', kind: 'smartfilter', streamId: 4, encodedFilter: 'stmts=abc' },
			{ id: 'ondeck', title: 'On Deck', kind: 'ondeck' }
		])
	})

	it('falls back to the built-in streams when the dashboard is empty or unusable', () => {
		const expected = [
			{ id: 'ondeck', title: 'On Deck', kind: 'ondeck' },
			{ id: 'recentlyupdated', title: 'Recently Updated', kind: 'recentlyupdated' },
			{ id: 'newlyadded', title: 'Newly Added', kind: 'newlyadded' }
		]
		assert.deepEqual(mapDashboardStreams([]), expected)
		assert.deepEqual(mapDashboardStreams(undefined), expected)
		assert.deepEqual(mapDashboardStreams({ title: 'error' }), expected)
		assert.deepEqual(mapDashboardStreams([{ id: 9, streamType: 4, smartFilterEncoded: null }]), expected)
	})

	it('maps libraries and parses section ids back', () => {
		assert.deepEqual(librarySections([{ id: 3, name: 'Manga', type: 0 }]), [{ id: '3', title: 'Manga', kind: 'library', libraryId: 3 }])
		assert.equal(parseSectionId('ondeck')?.kind, 'ondeck')
		assert.equal(parseSectionId('newlyadded')?.kind, 'newlyadded')
		assert.deepEqual(parseSectionId('smartfilter-12'), { id: 'smartfilter-12', title: '', kind: 'smartfilter', streamId: 12 })
		assert.deepEqual(parseSectionId('7'), { id: '7', title: '', kind: 'library', libraryId: 7 })
		assert.equal(parseSectionId('placeholder-id'), undefined)
	})
})

describe('settings helpers', () => {
	it('normalises the server address', () => {
		assert.equal(normaliseServerAddress('  kavita.local:5000  '), 'http://kavita.local:5000')
		assert.equal(normaliseServerAddress('https://kavita.example.com/'), 'https://kavita.example.com')
		assert.equal(normaliseServerAddress('https://kavita.example.com/api/'), 'https://kavita.example.com')
		assert.equal(normaliseServerAddress('http://10.0.0.2:5000/kavita/API'), 'http://10.0.0.2:5000/kavita')
		assert.equal(normaliseServerAddress('HTTPS://host//'), 'HTTPS://host')
		assert.equal(normaliseServerAddress('https://host/apikeys'), 'https://host/apikeys')
		assert.equal(normaliseServerAddress('   '), '')
		assert.equal(normaliseServerAddress(undefined), '')
		assert.equal(apiUrlFor('http://kavita.local:5000'), 'http://kavita.local:5000/api')
	})

	it('describes the connection without the API key', () => {
		assert.equal(describeConnection({ apiKeyEmpty: true }), 'Not connected: API key is empty')
		assert.equal(describeConnection({ status: undefined }), 'Not connected: server unreachable')
		assert.equal(describeConnection({ status: 401 }), 'Not connected: invalid API key')
		assert.equal(describeConnection({ status: 200, body: { token: 't', username: 'kai', kavitaVersion: '0.9.0.2', apiKey: 'secret' } }), 'Connected to Kavita 0.9.0.2 as kai')
		assert.equal(describeConnection({ status: 200, body: '<html>' }), 'Not connected: unexpected response (check the server URL)')
		assert.equal(describeConnection({ status: 502 }), 'Not connected: server returned HTTP 502')
	})
})
