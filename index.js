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
   "version": "0.2.0",
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

function getExternalManifest(req, res, isUnified) {
	let catalogType = false
	if (isUnified) {
		catalogType = req.params.catalogType || 'mdblist'
	}

	const listId = req.params.listIds;
	const mdbListKey = req.params.mdbListKey;

	if (!listId || !mdbListKey) {
		res.status(500).send('Invalid list ID or mDBList Key');
		return;
	}

	needle.get(`https://api.mdblist.com/external/lists/user?apikey=${mdbListKey}`, { follow_max: 3 }, (err, resp, body) => {
		if (!err && resp.statusCode === 200 && body && Array.isArray(body) && body.length) {
			const extList = body.find(el => {
				return el.id === parseInt(listId)
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
				manifestClone.name = listName;
				manifestClone.id = `com.mdblist.external-${isUnified ? 'unified-' : ''}${listId}`;
				manifestClone.types = types;
				const catalogs = [];
				types.forEach(type => {
					const catalogClone = JSON.parse(JSON.stringify(catalogTemplate));
					catalogClone.name = listName;
					catalogClone.id = `external-${listId}-${type}`;
					catalogClone.type = type;
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
	});
}

// New route for external manifest
app.get('/external/:listIds/:mdbListKey/:userKey?/manifest.json', (req, res) => {
	getExternalManifest(req, res, false)
});

app.get('/unified-external/:listIds/:mdbListKey/:catalogType/:userKey?/manifest.json', (req, res) => {
	getExternalManifest(req, res, true)
});

function getManifest(req, res, isUnified) {
	let catalogType = false
	if (isUnified) {
		catalogType = req.params.catalogType || 'mdblist'
	}
	if (req.params.mdbListKey.startsWith(`userapi-`)) {
		const listId = req.params.listIds
		const user = req.params.mdbListKey.replace('userapi-', '').split('-')[0]
		const mdbListKey = req.params.mdbListKey.replace('userapi-', '').split('-')[1]

		needle.get(`https://api.mdblist.com/lists/${user}/${listId}?apikey=${mdbListKey}`, { follow_max: 3 }, (err, resp, body) => {
				if (!err && resp.statusCode === 200 && body && Array.isArray(body) && body.length) {
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
						manifestClone.name = listName
						manifestClone.id = `com.mdblist.${user}${isUnified ? 'unified-' : ''}-${listId}`
						manifestClone.types = types
						const catalogs = []
						types.forEach(type => {
							const catalogClone = JSON.parse(JSON.stringify(catalogTemplate))
							catalogClone.name = listName
							catalogClone.id = listId+'-'+type
							catalogClone.type = type
							catalogs.push(catalogClone)
						})
						manifestClone.catalogs = catalogs
						res.setHeader('Cache-Control', `public, max-age=${24 * 60 * 60}`)
						res.json(manifestClone)

						return;
					}
				}
				res.status(500).send('Error from mDBList API')
		})
	} else if (req.params.mdbListKey === `user-${demos.username}`) {
		const listId = req.params.listIds
		const list = demos.lists.find(el => el.id === listId)
		if (!list) {
			res.status(500).send('No such demo list')
			return
		}
		const manifestClone = JSON.parse(JSON.stringify(manifestTemplate))
		manifestClone.name = list.name
		manifestClone.id = `com.mdblist.${isUnified ? 'unified-' : ''}${list.id}`
		manifestClone.types = [catalogType || list.type]
		const catalogClone = JSON.parse(JSON.stringify(catalogTemplate))
		catalogClone.name = list.name
		catalogClone.id = list.id
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
			needle.get(`https://api.mdblist.com/lists/${listIds[0]}/?apikey=${mdbListKey}`, { follow_max: 3 }, (err, resp, body) => {
				if (!err && resp.statusCode === 200 && ((body || [])[0] || {}).name) {
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
					manifestClone.name = listName
					manifestClone.id = `com.mdblist.${isUnified ? 'unified-' : ''}${slug}`
					manifestClone.types = types
					const catalogs = []
					types.forEach(type => {
						const catalogClone = JSON.parse(JSON.stringify(catalogTemplate))
						catalogClone.name = listName
						catalogClone.id = slug+'-'+type
						catalogClone.type = type
						catalogs.push(catalogClone)
					})
					manifestClone.catalogs = catalogs
					res.setHeader('Cache-Control', `public, max-age=${24 * 60 * 60}`)
					res.json(manifestClone)
				} else {
					res.status(500).send('Error from mDBList API')
				}
			})
		} else {
			res.status(500).send('Too many list IDs')
		}
	}
}

app.get('/:listIds/:mdbListKey/:userKey?/manifest.json', (req, res) => {
	getManifest(req, res, false)
})

app.get('/unified/:listIds/:mdbListKey/:catalogType/:userKey?/manifest.json', (req, res) => {
	getManifest(req, res, true)
})

function mdbToStremio(userKey, obj) {
	return {
		id: obj.imdb_id,
		imdb_id: obj.imdb_id,
		name: obj.title,
		releaseInfo: obj.release_year + '',
		type: obj.mediatype === 'show' ? 'series' : 'movie',
		poster: userKey ? `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${obj.imdb_id}.jpg?fallback=true` : `https://images.metahub.space/poster/small/${obj.imdb_id}/img`,
		logo: `https://images.metahub.space/logo/medium/${obj.imdb_id}/img`,
		background: `https://images.metahub.space/background/medium/${obj.imdb_id}/img`,
	}
}

function getCinemetaForIds(type, ids, cb) {
	const imdbIds = ids.join(',')
	needle.get(`https://v3-cinemeta.strem.io/catalog/${type}/last-videos/lastVideosIds=${imdbIds}.json`, (err, resp, body) => {
		cb((body || {}).metasDetailed || [])
	})
}

const perPage = 100

function unifiedList(req, res, mdbBody, userKey) {
	if (Array.isArray(mdbBody) && mdbBody.length && mdbBody[0].title) {
		let firstType = 'movie'
		let items1 = mdbBody.filter(el => el.mediatype === 'movie')
		let items2 = mdbBody.filter(el => el.mediatype === 'show')
		if (!items1.length && !items2.length) {
			res.json({ metas: [] });
			return
		}
		if (!items1.length && items2.length) {
			items1 = JSON.parse(JSON.stringify(items2))
			items2 = []
			firstType = 'series'
		}
		items1 = items1.map(mdbToStremio.bind(null, userKey));
		items2 = items2.map(mdbToStremio.bind(null, userKey));
		function orderList(metasDetailed) {
			const newList = []
			mdbBody.map(mdbToStremio.bind(null, userKey)).forEach(el => {
				const item = metasDetailed.find(elm => elm.id === el.id)
				if (item) {
					newList.push(item)
				} else {
					newList.push(el)
				}
			})
			res.json({
				metas: newList.map((el, ij) => {
					el = el || items[ij];
					if (el.id && el.id.startsWith('tt') && userKey) {
						el.poster = `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${el.id}.jpg?fallback=true`;
					}
					return el;
				})
			});
		}
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
	} else {
		res.json({ metas: [] });
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

	let url = `https://api.mdblist.com/external/lists/${listId}/items?apikey=${mdbListKey}&limit=${perPage}&offset=${skip}&append_to_response=genre`;
	if (genre) {
		url += `&filter_genre=${encodeURIComponent(genre.toLowerCase())}`;
	}
	if (isUnified) {
		url += `&unified=true`
	}
	needle.get(url, { follow_max: 3 }, (err, resp, mdbBody) => {
		if (!err && resp.statusCode === 200) {
			if (isUnified) {
				unifiedList(req, res, mdbBody, userKey)
				return;
			} else {
				const mdbType = type === 'movie' ? 'movies' : 'shows';
				const body = ((mdbBody || {})[mdbType] || []).length ? mdbBody[mdbType] : mdbBody; // Fallback to raw body if no movies/shows key
				if (Array.isArray(body) && body.length && body[0].title) {
					res.setHeader('Cache-Control', `public, max-age=${1 * 60 * 60}`);
					const items = body.map(mdbToStremio.bind(null, userKey));
					getCinemetaForIds(type, items.map(el => el.imdb_id), (metasDetailed) => {
						if (metasDetailed.length) {
							res.json({
								metas: metasDetailed.map((el, ij) => {
									el = el || items[ij];
									if (el.id && el.id.startsWith('tt') && userKey) {
										el.poster = `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${el.id}.jpg?fallback=true`;
									}
									return el;
								})
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
	});
}

app.get('/unified-external/:listIds/:mdbListKey/:catalogType/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getExternalList(req, res, true)
});

app.get('/external/:listIds/:mdbListKey/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getExternalList(req, res, false)
});

function getList(req, res, isUnified) {
	if (req.params.mdbListKey.startsWith(`userapi-`)) {
		const listId = req.params.listIds
		if (!listId) {
			res.status(500).send('Invalid mDBList list slug')
			return
		}
		const user = req.params.mdbListKey.replace('userapi-', '').split('-')[0]
		if (!user) {
			res.status(500).send('Invalid mDBList list user')
			return
		}
		const mdbListKey = req.params.mdbListKey.replace('userapi-', '').split('-')[1]
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
		const type = req.params.type
		const mdbListType = type === 'movie' ? 'movie' : 'show'

		let url = false

		if (!isUnified) {
			url = `https://api.mdblist.com/lists/${user}/${listId}/items/${mdbListType}?apikey=${mdbListKey}&limit=${perPage}&offset=${(skip || 0)}&append_to_response=genre`
			if (genre)
				url += `&filter_genre=${encodeURIComponent(genre.toLowerCase())}`
		} else {
			url = `https://api.mdblist.com/lists/${user}/${listId}/items?apikey=${mdbListKey}&limit=${perPage}&offset=${(skip || 0)}&append_to_response=genre`
			if (genre)
				url += `&filter_genre=${encodeURIComponent(genre.toLowerCase())}`
			url += `&unified=true`
		}

		needle.get(url, { follow_max: 3 }, (err, resp, mdbBody) => {
			if (!err && resp.statusCode === 200) {
				if (isUnified) {
					unifiedList(req, res, mdbBody, userKey)
					return;
				}
				const mdbType = type === 'movie' ? 'movies' : 'shows'
				if (((mdbBody || {})[mdbType] || []).length && mdbBody[mdbType][0].title) {
					body = mdbBody[mdbType]
					res.setHeader('Cache-Control', `public, max-age=${1 * 60 * 60}`)
					const items = body.map(mdbToStremio.bind(null, userKey))
					getCinemetaForIds(type, items.map(el => el.imdb_id), (metasDetailed) => {
						if (metasDetailed.length) {
							res.json({
								metas: metasDetailed.map((el, ij) => {
									el = el || items[ij]
									if (el.id && el.id.startsWith('tt') && userKey)
										el.poster = `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${el.id}.jpg?fallback=true`
									return el
								})
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
		})

	} else if (req.params.mdbListKey === `user-${demos.username}`) {
		const listId = req.params.listIds
		const extra = req.params.extra ? qs.parse(req.url.split('/').pop().slice(0, -5)) : {}
		const skip = parseInt(extra.skip || 0)
		const type = req.params.type
		const url = `https://mdblist.com/lists/${demos.username}/${listId}/json?limit=${perPage}&offset=${(skip || 0)}`
		if (isUnified) {
			url += `&unified=true`
		}
		const userKey = req.params.userKey
		if (userKey && !isUserKeySane(userKey)) {
			res.status(500).send('Invalid RPDB Key')
			return
		}
		needle.get(url, { follow_max: 3 }, (err, resp, body) => {
			if (!err && resp.statusCode === 200 && body[0].title) {
				if (isUnified) {
					unifiedList(req, res, mdbBody, userKey)
					return;
				}
				res.setHeader('Cache-Control', `public, max-age=${1 * 60 * 60}`)
				const items = body.map(mdbToStremio.bind(null, userKey))
				getCinemetaForIds(type, items.map(el => el.imdb_id), (metasDetailed) => {
					if (metasDetailed.length) {
						res.json({
							metas: metasDetailed.map((el, ij) => {
								el = el || items[ij]
								if (el.id && el.id.startsWith('tt') && userKey)
									el.poster = `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${el.id}.jpg?fallback=true`
								return el
							})
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
		})
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
		const type = req.params.type
		if (listIds.length === 1) {
			let url = `https://api.mdblist.com/lists/${listIds[0]}/items/?apikey=${mdbListKey}&limit=${perPage}&offset=${(skip || 0)}&append_to_response=genre`
			if (genre)
				url += `&filter_genre=${encodeURIComponent(genre.toLowerCase())}`
			if (isUnified) {
				url += `&unified=true`
			}
			needle.get(url, { follow_max: 3 }, (err, resp, mdbBody) => {
				if (!err && resp.statusCode === 200) {
					if (isUnified) {
						unifiedList(req, res, mdbBody, userKey)
						return;
					}
					const mdbType = type === 'movie' ? 'movies' : 'shows'
					if (((mdbBody || {})[mdbType] || []).length && mdbBody[mdbType][0].title) {
						body = mdbBody[mdbType]
						res.setHeader('Cache-Control', `public, max-age=${1 * 60 * 60}`)
						const items = body.map(mdbToStremio.bind(null, userKey))
						getCinemetaForIds(type, items.map(el => el.imdb_id), (metasDetailed) => {
							if (metasDetailed.length) {
								res.json({
									metas: metasDetailed.map((el, ij) => {
										el = el || items[ij]
										if (el.id && el.id.startsWith('tt') && userKey)
											el.poster = `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${el.id}.jpg?fallback=true`
										return el
									})
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
			})
		} else {
			res.status(500).send('Too many list IDs')
		}
	}
}

app.get('/unified/:listIds/:mdbListKey/:catalogType/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getList(req, res, true)
})

app.get('/:listIds/:mdbListKey/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
	getList(req, res, false)
})

const port = process.env.PORT || 64321

app.listen(port, () => {
	console.log(`http://localhost:${port}/manifest.json`)	
})