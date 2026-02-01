const express = require('express')
const needle = require('needle')
const app = express()
const cors = require('cors')
const qs = require('querystring')
const path = require('path')

const demos = require('./demo_lists')

app.use(cors())

function isUserKeySane(key) {
	return key && [0,1,2,3,4].find(el => key.startsWith(`t${el}-`)) !== undefined
}

const manifestTemplate = {
   "id": "com.mdblist.lists",
   "logo": "https://mdblist.com/static/mdblist.png",
   "version": "0.2.2",
   "description": "Addon for MDBList custom lists, optionally supports rating posters from RPDB.",
   "name": "MDBList",
   "resources": [
      "catalog",
   ],
   "types": [
      "movie",
      "series"
   ],
   "idPrefixes": [
      "tt"
   ],
   "catalogs": []
}

const genres = require('./genres')

const catalogTemplate = {
     "type":"movie",
     "id": "mdblist-list",
     "genres": genres,
     "extra": [
        {
           "name": "genre",
           "options": genres,
        },
        {
           "name":"skip"
        }
     ],
     "extraSupported": [
        "genre",
        "skip"
     ],
     "name": "List"
}

const isArray = (body) => {
	return Array.isArray(body) && body.length
}

function safeCallback(res, cb) {
	return function(err, resp, body) {
		try {
			cb(err, resp, body)
		} catch(e) {
			console.error('Unexpected error processing response:', e)
			if (!res.headersSent)
				res.status(500).send('Internal Server Error')
		}
	}
}

app.get('/manifest.json', (req, res) => {
	const manifestClone = JSON.parse(JSON.stringify(manifestTemplate))
	if (!manifestClone.behaviorHints)
		manifestClone.behaviorHints = {}
	manifestClone.behaviorHints.configurable = true
	manifestClone.behaviorHints.configurationRequired = true
	res.json(manifestClone)
})

app.get('/configure', (req, res) => {
	res.sendFile(path.resolve('./configure.html'))
})

app.get('/what_is_mdblist', (req, res) => {
	res.sendFile(path.resolve('./what_is_mdblist.html'))
})

app.get('/demo_lists', (req, res) => {
	res.sendFile(path.resolve('./demo_lists.html'))
})

app.get('/demos.json', (req, res) => {
	res.json(demos)
})

function getExternalManifest(req, res, isUnified, hasSearch) {
	let catalogType = false
	if (isUnified) {
		catalogType = req.params.catalogType || 'mdblist'
	}
	const extraOpts = []
	if (isUnified)
		extraOpts.push('unified')
	if (hasSearch)
		extraOpts.push('withsearch')
	const listId = req.params.listIds;
	const mdbListKey = req.params.mdbListKey;

	if (!listId || !mdbListKey) {
		res.status(500).send('Invalid list ID or mDBList Key');
		return;
	}

	needle.get(`https://api.mdblist.com/external/lists/user?apikey=${mdbListKey}`, { follow_max: 3 }, safeCallback(res, (err, resp, body) => {
		if (!err && resp.statusCode === 200 && isArray(body)) {
			const extList = body.find(el => {
				return el && el.id === parseInt(listId)
			})
			if (!extList) {
				res.status(500).send('Could not find an external list with this id for this mdblist account');
				return;
			}
			const listName = extList.name || 'External List';
			const types = [];
			if (catalogType) {
				types.push(catalogType)
			} else {
				if (extList.items) types.push('movie');
				if (extList.items_show) types.push('series');
				if (!types.length) types.push('movie');
			}

			if (types.length) {
				const manifestClone = JSON.parse(JSON.stringify(manifestTemplate));
				extraOpts.push(listId)
				manifestClone.name = listName;
				manifestClone.id = `com.mdblist.external-${extraOpts.join('-')}`;
				manifestClone.types = types;
				const catalogs = [];
				types.forEach(type => {
					const catalogClone = JSON.parse(JSON.stringify(catalogTemplate));
					catalogClone.name = listName;
					catalogClone.id = `external-${isUnified ? 'unified-' : ''}${hasSearch ? 'withsearch-' : ''}${listId}-${type}`;
					catalogClone.type = type;
					if (hasSearch) {
						catalogClone.extra.push({
							name: 'search'
						})
						catalogClone.extraSupported.push('search')
					}
					catalogs.push(catalogClone);
				});
				manifestClone.catalogs = catalogs;
				res.setHeader('Cache-Control', `public, max-age=${24 * 60 * 60}`);
				res.json(manifestClone);
			} else {
				res.status(500).send('No valid types found in external list');
			}
		} else {
			res.status(500).send('Error from mDBList External API');
		}
	}));
}

// New route for external manifest
app.get('/external/:listIds/:mdbListKey/:userKey?/manifest.json', (req, res) => {
	getExternalManifest(req, res, false)
});

app.get('/unified-external/:listIds/:mdbListKey/:catalogType/:userKey?/manifest.json', (req, res) => {
	getExternalManifest(req, res, true)
});

app.get('/unified-watchlist-external/:listIds/:mdbListKey/:catalogType/:userKey?/manifest.json', (req, res) => {
	getExternalManifest(req, res, true, true)
});

app.get('/watchlist-external/:listIds/:mdbListKey/:catalogType/:userKey?/manifest.json', (req, res) => {
	getExternalManifest(req, res, false, true)
});

function getManifest(req, res, isUnified, isWatchlist, hasSearch) {
	let catalogType = false
	if (isUnified) {
		catalogType = req.params.catalogType || 'mdblist'
	}
	const extraOpts = []
	if (isUnified)
		extraOpts.push('unified')
	if (hasSearch)
		extraOpts.push('withsearch')
	if (isWatchlist)
		extraOpts.push('watchlist')
	if (isWatchlist) {
		const manifestClone = JSON.parse(JSON.stringify(manifestTemplate))
		manifestClone.name = 'MDBList'
		manifestClone.id = `com.mdblist.${extraOpts.join('-')}`
		if (catalogType) {
			manifestClone.types = [catalogType]
		} else {
			manifestClone.types = ['movie', 'series']
		}
		manifestClone.catalogs = []
		manifestClone.types.forEach(catType => {
			const catalogClone = JSON.parse(JSON.stringify(catalogTemplate))
			catalogClone.name = 'Watchlist'
			catalogClone.id = (isUnified ? 'unified2-' : '') + (hasSearch ? 'withsearch2-' : '') + 'mdbwatchlist'
			catalogClone.type = catType
			if (hasSearch) {
				catalogClone.extra.push({
					name: 'search'
				})
				catalogClone.extraSupported.push('search')
			}
			manifestClone.catalogs.push(catalogClone)
		})
		res.setHeader('Cache-Control', `public, max-age=${24 * 60 * 60}`)
		res.json(manifestClone)
	} else if (req.params.mdbListKey.startsWith(`userapi-`)) {
		const listId = req.params.listIds
		const combined = req.params.mdbListKey.replace('userapi-', '')
		const lastHyphenIndex = combined.lastIndexOf('-')
		const user = combined.slice(0, lastHyphenIndex)
		const mdbListKey = combined.slice(lastHyphenIndex + 1)

		needle.get(`https://api.mdblist.com/lists/${user}/${encodeURIComponent(listId)}?apikey=${mdbListKey}`, { follow_max: 3 }, safeCallback(res, (err, resp, body) => {
				if (!err && resp.statusCode === 200 && isArray(body) && body[0]) {
					const listName = body[0].name
					const types = []
					if (catalogType) {
						types.push(catalogType)
					} else {
						if (body[0].mediatype) {
							body.forEach(el => {
								if ((el || {}).items)
									types.push(el.mediatype === 'show' ? 'series' : 'movie')
							})
						} else {
							if (body[0].movies)
								types.push('movie')
							if (body[0].shows)
								types.push('series')
							if (!types.length)
								types.push('movie')
						}
					}
					if (types.length) {
						const manifestClone = JSON.parse(JSON.stringify(manifestTemplate))
						extraOpts.push(listId)
						manifestClone.name = listName
						manifestClone.id = `com.mdblist.${user}${extraOpts.join('-')}`
						manifestClone.types = types
						const catalogs = []
						types.forEach(type => {
							const catalogClone = JSON.parse(JSON.stringify(catalogTemplate))
							catalogClone.name = listName
							catalogClone.id = (isUnified ? 'unified-' : '') + (hasSearch ? 'withsearch-' : '') + listId+'-'+type
							catalogClone.type = type
							if (hasSearch) {
								catalogClone.extra.push({
									name: 'search'
								})
								catalogClone.extraSupported.push('search')
							}
							catalogs.push(catalogClone)
						})
						manifestClone.catalogs = catalogs
						res.setHeader('Cache-Control', `public, max-age=${24 * 60 * 60}`)
						res.json(manifestClone)

						return;
					}
				}
				res.status(500).send('Error from mDBList API')
		}))
	} else if (req.params.mdbListKey === `user-${demos.username}`) {
		const listId = req.params.listIds
		const list = demos.lists.find(el => el.id === listId)
		if (!list) {
			res.status(500).send('No such demo list')
			return
		}
		extraOpts.push(list.id)
		const manifestClone = JSON.parse(JSON.stringify(manifestTemplate))
		manifestClone.name = list.name
		manifestClone.id = `com.mdblist.${extraOpts.join('-')}`
		manifestClone.types = [catalogType || list.type]
		const catalogClone = JSON.parse(JSON.stringify(catalogTemplate))
		catalogClone.name = list.name
		catalogClone.id = (isUnified ? 'unified2-' : '') + (hasSearch ? 'withsearch2-' : '') + list.id
		catalogClone.type = catalogType || list.type
		delete catalogClone.genres
		catalogClone.extra = [
         {
           "name":"skip"
         }
		]
		catalogClone.extraSupported = ["skip"]
		manifestClone.catalogs = [catalogClone]
		res.setHeader('Cache-Control', `public, max-age=${24 * 60 * 60}`)
		res.json(manifestClone)
	} else {
		const listIds = (req.params.listIds || '').split(',')
		if (!listIds.length) {
			res.status(500).send('Invalid mDBList list IDs')
			return
		}
		const mdbListKey = req.params.mdbListKey
		if (!mdbListKey) {
			res.status(500).send('Invalid mDBList Key')
			return
		}
		if (listIds.length === 1) {
			needle.get(`https://api.mdblist.com/lists/${encodeURIComponent(listIds[0])}/?apikey=${mdbListKey}`, { follow_max: 3 }, safeCallback(res, (err, resp, body) => {
				if (!err && resp.statusCode === 200 && isArray(body) && body[0] && body[0].name) {
					const types = []
					if (catalogType) {
						types.push(catalogType)
					} else {
						if (body[0].mediatype) {
							body.forEach(el => {
								if ((el || {}).items)
									types.push(el.mediatype === 'show' ? 'series' : 'movie')
							})
						} else {
							if (body[0].movies)
								types.push('movie')
							if (body[0].shows)
								types.push('series')
							if (!types.length)
								types.push('movie')
						}
					}
					const manifestClone = JSON.parse(JSON.stringify(manifestTemplate))
					const listName = body[0].name
					const slug = body[0].slug
					extraOpts.push(slug)
					manifestClone.name = listName
					manifestClone.id = `com.mdblist.${extraOpts.join('-')}`
					manifestClone.types = types
					const catalogs = []
					types.forEach(type => {
						const catalogClone = JSON.parse(JSON.stringify(catalogTemplate))
						catalogClone.name = listName
						catalogClone.id = (isUnified ? 'unified3-' : '') + (hasSearch ? 'withsearch3-' : '') + slug+'-'+type
						catalogClone.type = type
						if (hasSearch) {
							catalogClone.extra.push({
								name: 'search'
							})
							catalogClone.extraSupported.push('search')
						}
						catalogs.push(catalogClone)
					})
					manifestClone.catalogs = catalogs
					res.setHeader('Cache-Control', `public, max-age=${24 * 60 * 60}`)
					res.json(manifestClone)
				} else {
					res.status(500).send('Error from mDBList API')
				}
			}))
		} else {
			res.status(500).send('Too many list IDs')
		}
	}
}

app.get('/unified/:listIds/:mdbListKey/:catalogType/:userKey?/manifest.json', (req, res) => {
	getManifest(req, res, true, false)
})

app.get('/withsearch/:listIds/:mdbListKey/:catalogType/:userKey?/manifest.json', (req, res) => {
	getManifest(req, res, false, false, true)
})

app.get('/unified-withsearch/:listIds/:mdbListKey/:catalogType/:userKey?/manifest.json', (req, res) => {
	getManifest(req, res, true, false, true)
})

app.get('/unified-watchlist/:mdbListKey/:catalogType/:userKey?/manifest.json', (req, res) => {
	getManifest(req, res, true, true)
})

app.get('/unified-withsearch-watchlist/:mdbListKey/:catalogType/:userKey?/manifest.json', (req, res) => {
	getManifest(req, res, true, true, true)
})

app.get('/watchlist/:mdbListKey/:userKey?/manifest.json', (req, res) => {
	getManifest(req, res, false, true)
})

app.get('/:listIds/:mdbListKey/:userKey?/manifest.json', (req, res) => {
	getManifest(req, res, false, false)
})

function mdbToStremio(userKey, obj) {
	const imdbId = getImdbId(obj)
	if (!imdbId) return null
	return {
		id: imdbId,
		imdb_id: imdbId,
		name: obj.title,
		releaseInfo: obj.release_year + '',
		type: obj.mediatype === 'show' ? 'series' : 'movie',
		poster: userKey ? `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${imdbId}.jpg?fallback=true` : `https://images.metahub.space/poster/small/${imdbId}/img`,
		logo: `https://images.metahub.space/logo/medium/${imdbId}/img`,
		background: `https://images.metahub.space/background/medium/${imdbId}/img`,
	}
}

function getImdbId(obj) {
	const id = obj && (obj.imdb_id || obj.imdbId || obj.imdb)
	if (typeof id !== 'string') return null
	if (!id.startsWith('tt')) return null
	return id
}

function hasImdbId(obj) {
	return !!getImdbId(obj)
}

function getCinemetaForIds(type, ids, cb) {
	const imdbIds = ids.join(',')
	needle.get(`https://v3-cinemeta.strem.io/catalog/${type}/last-videos/lastVideosIds=${imdbIds}.json`, (err, resp, body) => {
		try {
			cb(((body || {}).metasDetailed || []).filter(el => !!el))
		} catch(e) {
			console.error('Unexpected error in cinemeta callback:', e)
			cb([])
		}
	})
}

const perPage = 100

function unifiedList(req, res, mdbBody, userKey) {
	try {
		if (isArray(mdbBody) && mdbBody[0] && mdbBody[0].title) {
			let firstType = 'movie'
			let items1 = mdbBody.filter(el => el && el.mediatype === 'movie').filter(hasImdbId)
			let items2 = mdbBody.filter(el => el && el.mediatype === 'show').filter(hasImdbId)
			if (!items1.length && !items2.length) {
				res.json({ metas: [] });
				return
			}
			if (!items1.length && items2.length) {
				items1 = JSON.parse(JSON.stringify(items2))
				items2 = []
				firstType = 'series'
			}
			items1 = items1.map(mdbToStremio.bind(null, userKey)).filter(Boolean);
			items2 = items2.map(mdbToStremio.bind(null, userKey)).filter(Boolean);
			function orderList(metasDetailed) {
				const newList = []
				const fallbackItems = mdbBody.filter(hasImdbId).map(mdbToStremio.bind(null, userKey)).filter(Boolean)
				fallbackItems.forEach(el => {
					const item = metasDetailed.find(elm => elm.id === el.id)
					if (item) {
						newList.push(item)
					} else {
						newList.push(el)
					}
				})
				res.json({
					metas: newList.map((el, ij) => {
						el = el || fallbackItems[ij];
						if (el && el.id && el.id.startsWith('tt') && userKey) {
							el.poster = `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${el.id}.jpg?fallback=true`;
						}
						return el;
					}).filter(Boolean)
				});
			}
			if (!items1.length) {
				if (items2.length) {
					getCinemetaForIds('series', items2.map(el => el.imdb_id), (metasDetailed2) => {
						let metasDetailed = []
						if (metasDetailed2 && metasDetailed2.length) {
							metasDetailed = metasDetailed.concat(metasDetailed2)
						}
						orderList(metasDetailed)
					})
				} else {
					orderList([])
				}
			} else {
				getCinemetaForIds(firstType, items1.map(el => el.imdb_id), (metasDetailed1) => {
					if (items2.length) {
						getCinemetaForIds('series', items2.map(el => el.imdb_id), (metasDetailed2) => {
							let metasDetailed = []
							if (metasDetailed1 && metasDetailed1.length) {
								metasDetailed = metasDetailed.concat(metasDetailed1)
							}
							if (metasDetailed2 && metasDetailed2.length) {
								metasDetailed = metasDetailed.concat(metasDetailed2)
							}
							orderList(metasDetailed)
						})
					} else {
						orderList(metasDetailed1 || [])
					}
				})
			}
		} else {
			res.json({ metas: [] });
		}
	} catch(e) {
		console.error('Unexpected error in unifiedList:', e)
		if (!res.headersSent)
			res.status(500).send('Internal Server Error')
	}
}

// New route for external catalog
function getExternalList(req, res, isUnified) {
	const listId = req.params.listIds;
	const mdbListKey = req.params.mdbListKey;
	const userKey = req.params.userKey;
	const type = req.params.type;

	if (!listId || !mdbListKey) {
		res.status(500).send('Invalid list ID or mDBList Key');
		return;
	}

	if (userKey && !isUserKeySane(userKey)) {
		res.status(500).send('Invalid RPDB Key');
		return;
	}

	const extra = req.params.extra ? qs.parse(req.url.split('/').pop().slice(0, -5)) : {};
	const skip = parseInt(extra.skip || 0);
	const genre = extra.genre;
	const search = extra.search;

	let url = `https://api.mdblist.com/external/lists/${encodeURIComponent(listId)}/items?apikey=${mdbListKey}&limit=${perPage}&offset=${skip}&append_to_response=genre`;
	if (genre) {
		url += `&filter_genre=${encodeURIComponent(genre.toLowerCase())}`;
	}
	if (search) {
		url += `&filter_title=${encodeURIComponent(search)}`;
	}
	if (isUnified) {
		url += `&unified=true`
	}
	needle.get(url, { follow_max: 3 }, safeCallback(res, (err, resp, mdbBody) => {
		if (!err && resp.statusCode === 200) {
			if (isUnified) {
				unifiedList(req, res, mdbBody, userKey)
				return;
			} else {
				const mdbType = type === 'movie' ? 'movies' : 'shows';
				const body = ((mdbBody || {})[mdbType] || []).length ? mdbBody[mdbType] : mdbBody; // Fallback to raw body if no movies/shows key
				if (isArray(body) && body[0] && body[0].title) {
					res.setHeader('Cache-Control', `public, max-age=${1 * 60 * 60}`);
					const items = body.filter(hasImdbId).map(mdbToStremio.bind(null, userKey)).filter(Boolean);
					if (!items.length) {
						res.json({ metas: [] });
						return;
					}
					getCinemetaForIds(type, items.map(el => el.imdb_id), (metasDetailed) => {
						if (metasDetailed.length) {
							res.json({
								metas: metasDetailed.map((el, ij) => {
									el = el || items[ij];
									if (el && el.id && el.id.startsWith('tt') && userKey) {
										el.poster = `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${el.id}.jpg?fallback=true`;
									}
									return el;
								}).filter(Boolean)
							});
						} else {
							res.json({ metas: items });
						}
					});
				} else {
					res.json({ metas: [] });
				}
			}
		} else {
			res.status(500).send('Error from mDBList External API');
		}
	}));
}

app.get('/unified-external/:listIds/:mdbListKey/:catalogType/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getExternalList(req, res, true)
});

app.get('/unified-withsearch-external/:listIds/:mdbListKey/:catalogType/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getExternalList(req, res, true)
});

app.get('/withsearch-external/:listIds/:mdbListKey/:catalogType/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getExternalList(req, res, false)
});

app.get('/external/:listIds/:mdbListKey/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getExternalList(req, res, false)
});

function getList(req, res, isUnified, isWatchlist) {
	if (isWatchlist) {
		const mdbListKey = req.params.mdbListKey
		if (!mdbListKey) {
			res.status(500).send('Invalid mDBList Key')
			return
		}
		const userKey = req.params.userKey
		if (userKey && !isUserKeySane(userKey)) {
			res.status(500).send('Invalid RPDB Key')
			return
		}
		const extra = req.params.extra ? qs.parse(req.url.split('/').pop().slice(0, -5)) : {}
		const skip = parseInt(extra.skip || 0)
		const genre = extra.genre
		const search = extra.search
		const type = req.params.type
		const mdbListType = type === 'movie' ? 'movie' : 'show'

		let url = false

		if (!isUnified) {
			url = `https://api.mdblist.com/watchlist/items/${mdbListType}?apikey=${mdbListKey}&limit=${perPage}&offset=${(skip || 0)}&append_to_response=genre`
			if (genre)
				url += `&filter_genre=${encodeURIComponent(genre.toLowerCase())}`
			if (search)
				url += `&filter_title=${encodeURIComponent(search)}`
		} else {
			url = `https://api.mdblist.com/watchlist/items?apikey=${mdbListKey}&limit=${perPage}&offset=${(skip || 0)}&append_to_response=genre`
			if (genre)
				url += `&filter_genre=${encodeURIComponent(genre.toLowerCase())}`
			if (search)
				url += `&filter_title=${encodeURIComponent(search)}`
			url += `&unified=true`
		}

		needle.get(url, { follow_max: 3 }, safeCallback(res, (err, resp, mdbBody) => {
			if (!err && resp.statusCode === 200) {
				if (isUnified) {
					unifiedList(req, res, mdbBody, userKey)
					return;
				}
				const mdbType = type === 'movie' ? 'movies' : 'shows'
				const body = (mdbBody || {})[mdbType]
				if (isArray(body) && body[0] && body[0].title) {
					res.setHeader('Cache-Control', `public, max-age=${1 * 60 * 60}`)
					const items = body.filter(hasImdbId).map(mdbToStremio.bind(null, userKey)).filter(Boolean)
					if (!items.length) {
						res.json({ metas: [] });
						return;
					}
					getCinemetaForIds(type, items.map(el => el.imdb_id), (metasDetailed) => {
						if (metasDetailed.length) {
							res.json({
								metas: metasDetailed.map((el, ij) => {
									el = el || items[ij]
									if (el && el.id && el.id.startsWith('tt') && userKey)
										el.poster = `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${el.id}.jpg?fallback=true`
									return el
								}).filter(Boolean)
							})
						} else {
							res.json({
								metas: items
							})
						}
					})
				} else {
					res.json({
						metas: []
					})
				}
			} else {
				res.status(500).send('Error from mDBList API')
			}
		}))

	} else if (req.params.mdbListKey.startsWith(`userapi-`)) {
		const listId = req.params.listIds
		if (!listId) {
			res.status(500).send('Invalid mDBList list slug')
			return
		}
		const combined = req.params.mdbListKey.replace('userapi-', '')
		const lastHyphenIndex = combined.lastIndexOf('-')
		const user = combined.slice(0, lastHyphenIndex)
		if (!user) {
			res.status(500).send('Invalid mDBList list user')
			return
		}
		const mdbListKey = combined.slice(lastHyphenIndex + 1)
		if (!mdbListKey) {
			res.status(500).send('Invalid mDBList Key')
			return
		}
		const userKey = req.params.userKey
		if (userKey && !isUserKeySane(userKey)) {
			res.status(500).send('Invalid RPDB Key')
			return
		}
		const extra = req.params.extra ? qs.parse(req.url.split('/').pop().slice(0, -5)) : {}
		const skip = parseInt(extra.skip || 0)
		const genre = extra.genre
		const search = extra.search
		const type = req.params.type
		const mdbListType = type === 'movie' ? 'movie' : 'show'

		let url = false

		if (!isUnified) {
			url = `https://api.mdblist.com/lists/${user}/${encodeURIComponent(listId)}/items/${mdbListType}?apikey=${mdbListKey}&limit=${perPage}&offset=${(skip || 0)}&append_to_response=genre`
			if (genre)
				url += `&filter_genre=${encodeURIComponent(genre.toLowerCase())}`
			if (search)
				url += `&filter_title=${encodeURIComponent(search)}`
		} else {
			url = `https://api.mdblist.com/lists/${user}/${encodeURIComponent(listId)}/items?apikey=${mdbListKey}&limit=${perPage}&offset=${(skip || 0)}&append_to_response=genre`
			if (genre)
				url += `&filter_genre=${encodeURIComponent(genre.toLowerCase())}`
			if (search)
				url += `&filter_title=${encodeURIComponent(search)}`
			url += `&unified=true`
		}

		needle.get(url, { follow_max: 3 }, safeCallback(res, (err, resp, mdbBody) => {
			if (!err && resp.statusCode === 200) {
				if (isUnified) {
					unifiedList(req, res, mdbBody, userKey)
					return;
				}
				const mdbType = type === 'movie' ? 'movies' : 'shows'
				const body = (mdbBody || {})[mdbType]
				if (isArray(body) && body[0] && body[0].title) {
					res.setHeader('Cache-Control', `public, max-age=${1 * 60 * 60}`)
					const items = body.filter(hasImdbId).map(mdbToStremio.bind(null, userKey)).filter(Boolean)
					if (!items.length) {
						res.json({ metas: [] });
						return;
					}
					getCinemetaForIds(type, items.map(el => el.imdb_id), (metasDetailed) => {
						if (metasDetailed.length) {
							res.json({
								metas: metasDetailed.map((el, ij) => {
									el = el || items[ij]
									if (el && el.id && el.id.startsWith('tt') && userKey)
										el.poster = `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${el.id}.jpg?fallback=true`
									return el
								}).filter(Boolean)
							})
						} else {
							res.json({
								metas: items
							})
						}
					})
				} else {
					res.json({
						metas: []
					})
				}
			} else {
				res.status(500).send('Error from mDBList API')
			}
		}))

	} else if (req.params.mdbListKey === `user-${demos.username}`) {
		const listId = req.params.listIds
		const extra = req.params.extra ? qs.parse(req.url.split('/').pop().slice(0, -5)) : {}
		const skip = parseInt(extra.skip || 0)
		const type = req.params.type
		let url = `https://mdblist.com/lists/${demos.username}/${listId}/json?limit=${perPage}&offset=${(skip || 0)}`
		if (isUnified) {
			url += `&unified=true`
		}
		const userKey = req.params.userKey
		if (userKey && !isUserKeySane(userKey)) {
			res.status(500).send('Invalid RPDB Key')
			return
		}
		needle.get(url, { follow_max: 3 }, safeCallback(res, (err, resp, body) => {
			if (!err && resp.statusCode === 200 && isArray(body) && body[0] && body[0].title) {
				if (isUnified) {
					unifiedList(req, res, body, userKey)
					return;
				}
				res.setHeader('Cache-Control', `public, max-age=${1 * 60 * 60}`)
				const items = body.filter(hasImdbId).map(mdbToStremio.bind(null, userKey)).filter(Boolean)
				if (!items.length) {
					res.json({ metas: [] });
					return;
				}
				getCinemetaForIds(type, items.map(el => el.imdb_id), (metasDetailed) => {
					if (metasDetailed.length) {
						res.json({
							metas: metasDetailed.map((el, ij) => {
								el = el || items[ij]
								if (el && el.id && el.id.startsWith('tt') && userKey)
									el.poster = `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${el.id}.jpg?fallback=true`
								return el
							}).filter(Boolean)
						})
					} else {
						res.json({
							metas: items
						})
					}
				})
			} else {
				res.status(500).send('Error from mDBList API')
			}
		}))
	} else {
		const listIds = (req.params.listIds || '').split(',')
		if (!listIds.length) {
			res.status(500).send('Invalid mDBList list IDs')
			return
		}
		const mdbListKey = req.params.mdbListKey
		if (!mdbListKey) {
			res.status(500).send('Invalid mDBList Key')
			return
		}
		const userKey = req.params.userKey
		if (userKey && !isUserKeySane(userKey)) {
			res.status(500).send('Invalid RPDB Key')
			return
		}
		const extra = req.params.extra ? qs.parse(req.url.split('/').pop().slice(0, -5)) : {}
		const skip = parseInt(extra.skip || 0)
		const genre = extra.genre
		const search = extra.search
		const type = req.params.type
		if (listIds.length === 1) {
			let url = `https://api.mdblist.com/lists/${encodeURIComponent(listIds[0])}/items/?apikey=${mdbListKey}&limit=${perPage}&offset=${(skip || 0)}&append_to_response=genre`
			if (genre)
				url += `&filter_genre=${encodeURIComponent(genre.toLowerCase())}`
			if (search)
				url += `&filter_title=${encodeURIComponent(search)}`
			if (isUnified) {
				url += `&unified=true`
			}
			needle.get(url, { follow_max: 3 }, safeCallback(res, (err, resp, mdbBody) => {
				if (!err && resp.statusCode === 200) {
					if (isUnified) {
						unifiedList(req, res, mdbBody, userKey)
						return;
					}
					const mdbType = type === 'movie' ? 'movies' : 'shows'
					const body = (mdbBody || {})[mdbType]
					if (isArray(body) && body[0] && body[0].title) {
						res.setHeader('Cache-Control', `public, max-age=${1 * 60 * 60}`)
						const items = body.filter(hasImdbId).map(mdbToStremio.bind(null, userKey)).filter(Boolean)
						if (!items.length) {
							res.json({ metas: [] });
							return;
						}

						getCinemetaForIds(type, items.map(el => el.imdb_id), (metasDetailed) => {
							if (metasDetailed.length) {
								res.json({
									metas: metasDetailed.map((el, ij) => {
										el = el || items[ij]
										if (el && el.id && el.id.startsWith('tt') && userKey)
											el.poster = `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${el.id}.jpg?fallback=true`
										return el
									}).filter(Boolean)
								})
							} else {
								res.json({
									metas: items
								})
							}
						})
					} else {
						res.json({
							metas: []
						})
					}
				} else {
					res.status(500).send('Error from mDBList API')
				}
			}))
		} else {
			res.status(500).send('Too many list IDs')
		}
	}
}

app.get('/unified-watchlist/:mdbListKey/:catalogType/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getList(req, res, true, true)
})

app.get('/withsearch-watchlist/:mdbListKey/:catalogType/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getList(req, res, false, true)
})

app.get('/unified-withsearch-watchlist/:mdbListKey/:catalogType/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getList(req, res, true, true)
})

app.get('/watchlist/:mdbListKey/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getList(req, res, false, true)
})

app.get('/unified/:listIds/:mdbListKey/:catalogType/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getList(req, res, true, false)
})

app.get('/withsearch/:listIds/:mdbListKey/:catalogType/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getList(req, res, false, false)
})

app.get('/unified-withsearch/:listIds/:mdbListKey/:catalogType/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getList(req, res, true, false)
})

app.get('/:listIds/:mdbListKey/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getList(req, res, false, false)
})

app.use((err, req, res, _next) => {
	console.error('Express error:', err)
	if (!res.headersSent)
		res.status(500).send('Internal Server Error')
})

process.on('uncaughtException', (err) => {
	console.error('Uncaught Exception:', err)
})

process.on('unhandledRejection', (err) => {
	console.error('Unhandled Rejection:', err)
})

const port = process.env.PORT || 64321

app.listen(port, () => {
	console.log(`http://localhost:${port}/manifest.json`)
})
