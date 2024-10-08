const express = require('express')
const needle = require('needle')
const app = express()
const cors = require('cors')
const qs = require('querystring')
const path = require('path')

app.use(cors())

function attachHeaders(resp, res) {
	if (resp.headers['cache-control'])
		res.setHeader('Cache-Control', resp.headers['cache-control'])
	if (resp.headers['content-type'])
		res.setHeader('Content-Type', resp.headers['content-type'])
}

function isUserKeySane(key) {
	return key && [0,1,2,3,4].find(el => key.startsWith(`t${el}-`)) !== undefined
}

const manifestTemplate = {
   "id": "com.mdblist.lists",
   "logo": "https://mdblist.com/static/mdblist.png",
   "version": "0.1.0",
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

app.get('/:listIds/:mdbListKey/:userKey?/manifest.json', (req, res) => {
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
		needle.get(`https://mdblist.com/api/lists/${listIds[0]}?apikey=${mdbListKey}`, { follow_max: 3 }, (err, resp, body) => {
			if (!err && resp.statusCode === 200 && ((body || [])[0] || {}).name) {
				const type = body[0].mediatype === 'show' ? 'series' : 'movie'
				const manifestClone = JSON.parse(JSON.stringify(manifestTemplate))
				manifestClone.name = body[0].name
				manifestClone.id = `com.mdblist.${body[0].slug}`
				manifestClone.types = [type]
				const catalogClone = JSON.parse(JSON.stringify(catalogTemplate))
				catalogClone.name = body[0].name
				catalogClone.id = body[0].slug
				catalogClone.type = type
				manifestClone.catalogs = [catalogClone]
				res.setHeader('Cache-Control', `public, max-age=${24 * 60 * 60}`)
				res.json(manifestClone)
			} else {
				res.status(500).send('Error from mDBList API')
			}
		})
	} else {
		res.status(500).send('Too maby list IDs')
	}
})

const perPage = 100

app.get('/:listIds/:mdbListKey/:userKey?/catalog/:type/:slug/:extra?.json', (req, res) => {
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
	if (listIds.length === 1) {
		needle.get(`https://mdblist.com/api/lists/${listIds[0]}/items?apikey=${mdbListKey}&limit=${perPage}&offset=${(skip || 0)}&append_to_response=genre`, { follow_max: 3 }, (err, resp, body) => {
			if (!err && resp.statusCode === 200 && ((body || [])[0] || {}).title) {
				res.setHeader('Cache-Control', `public, max-age=${24 * 60 * 60}`)
				const items = body.filter(el => (!!el.imdb_id && (!genre || (el.genre || []).includes(genre)))).map(obj => ({
					id: obj.imdb_id,
					imdb_id: obj.imdb_id,
					name: obj.title,
					releaseInfo: obj.release_year + '',
					type: obj.mediatype === 'show' ? 'series' : 'movie',
					poster: userKey ? `https://api.ratingposterdb.com/${userKey}/imdb/poster-default/${obj.imdb_id}.jpg?fallback=true` : `https://images.metahub.space/poster/small/${obj.imdb_id}/img`,
					logo: `https://images.metahub.space/logo/medium/${obj.imdb_id}/img`,
					background: `https://images.metahub.space/background/medium/${obj.imdb_id}/img`,
				}))
				const imdbIds = items.map(el => el.imdb_id).join(',')
				needle.get(`https://v3-cinemeta.strem.io/catalog/${req.params.type}/last-videos/lastVideosIds=${imdbIds}.json`, (err, resp, body) => {
					if (((body || {}).metasDetailed || []).length) {
						res.json({
							metas: body.metasDetailed.map((el, ij) => {
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
		res.status(500).send('Too maby list IDs')
	}
})

const port = process.env.PORT || 64321

app.listen(port, () => {
	console.log(`http://localhost:${port}/manifest.json`)	
})
