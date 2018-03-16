/**
 * Copyright 2015-2016, Google, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const express = require('express');
require('express-csv');
const pwaLib = require('../../lib/pwa');
const libMetadata = require('../../lib/metadata');
const router = express.Router(); // eslint-disable-line new-cap
const CACHE_CONTROL_EXPIRES = 60 * 60 * 1; // 1 hour
const RSS = require('rss');

function getDate(date) {
  return new Date(date).toISOString().split('T')[0];
}

class CsvWriter {
  write(result, pwas) {
    const csv = [];
    pwas.forEach(pwa => {
      const created = getDate(pwa.created);
      const updated = getDate(pwa.updated);
      const csvLine = [];
      csvLine.push(pwa.id);
      csvLine.push(pwa.absoluteStartUrl);
      csvLine.push(pwa.manifestUrl);
      csvLine.push(pwa.lighthouseScore);
      csvLine.push(created);
      csvLine.push(updated);
      csv.push(csvLine);
    });
    result.setHeader('Content-Type', 'text/csv');
    csv.unshift(
      ['id', 'absoluteStartUrl', 'manifestUrl', 'lighthouseScore', 'created', 'updated']);
    result.csv(csv);
  }
}

class JsonWriter {
  write(result, pwas) {
    const pwaList = [];
    pwas.forEach(dbPwa => {
      const created = getDate(dbPwa.created);
      const updated = getDate(dbPwa.updated);
      const pwa = {};
      pwa.id = dbPwa.id;
      pwa.absoluteStartUrl = dbPwa.absoluteStartUrl;
      pwa.manifestUrl = dbPwa.manifestUrl;
      pwa.lighthouseScore = dbPwa.lighthouseScore;
      pwa.webPageTest = dbPwa.webPageTest;
      pwa.pageSpeed = dbPwa.pageSpeed;
      pwa.created = created;
      pwa.updated = updated;
      pwaList.push(pwa);
    });
    result.setHeader('Content-Type', 'application/json');
    result.json(pwaList);
  }
}

function render(res, view, options) {
  return new Promise((resolve, reject) => {
    res.render(view, options, (err, html) => {
      if (err) {
        console.log(err);
        reject(err);
      }
      resolve(html);
    });
  });
}

function renderOnePwaRss(pwa, req, res) {
  const url = req.originalUrl;
  const contentOnly = false || req.query.contentOnly;
  let arg = Object.assign(libMetadata.fromRequest(req, url), {
    pwa: pwa,
    title: 'PWA Directory: ' + pwa.name,
    description: 'PWA Directory: ' + pwa.name + ' - ' + pwa.description,
    backlink: true,
    contentOnly: contentOnly
    });
    return render(res, 'pwas/view-rss.hbs', arg);
}

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array)
  }
}

class RssWriter {
  write(req, res, pwas) {
    const feed = new RSS({
      /* eslint-disable camelcase */
      title: 'PWA Directory',
      description: 'A Directory of Progressive Web Apps',
      feed_url: 'https://pwa-directory.appspot.com/api/pwa?format=rss',
      site_url: 'https://pwa-directory.appspot.com/',
      image_url: 'https://pwa-directory.appspot.com/favicons/android-chrome-144x144.png',
      pubDate: new Date(),
      custom_namespaces: {
        rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
        l: 'http://purl.org/rss/1.0/modules/link/',
        media: 'http://search.yahoo.com/mrss/'
      }
    });

    const start = async _ => {
      await asyncForEach(pwas, async pwa => {
        let html = await renderOnePwaRss(pwa, req, res);
        feed.item({
          title: pwa.displayName,
          url: 'https://pwa-directory.appspot.com/pwas/' + pwa.id,
          description: html,
          guid: pwa.id,
          date: pwa.created,
          custom_elements: [
            {'media:thumbnail': {_attr: {url: pwa.iconUrl128,
              height: '128', width: '128'}}},
            {'l:link': {_attr: {'l:rel': 'http://purl.org/rss/1.0/modules/link/#alternate',
              'l:type': 'application/json',
              'rdf:resource': 'https://pwa-directory.appspot.com/api/pwa/' + pwa.id}}}
          ]
        });
      });
      res.setHeader('Content-Type', 'application/rss+xml');
      res.status(200).send(feed.xml());
    };
    start();
    /* eslint-enable camelcase */
  }
}

const csvWriter = new CsvWriter();
const jsonWriter = new JsonWriter();
const rssWriter = new RssWriter();

/**
 * GET /api/pwa
 *
 * Returns all PWAs as JSON or ?format=csv for CSV.
 */
router.get('/:id*?', (req, res) => {
  let format = req.query.format || 'json';
  let sort = req.query.sort || 'newest';
  let skip = parseInt(req.query.skip, 10);
  let limit = parseInt(req.query.limit, 10) || 100;
  res.setHeader('Cache-Control', 'public, max-age=' + CACHE_CONTROL_EXPIRES);

  return new Promise((resolve, reject) => {
    if (req.params.id) { // Single PWA
      pwaLib.find(req.params.id)
        .then(onePwa => {
          resolve({pwas: [onePwa]});
        })
        .catch(err => {
          console.log(err);
          res.status(404);
          res.json(err);
        });
    } else {
      resolve(pwaLib.list(skip, limit, sort));
    }
  })
  .then(result => {
    switch (format) {
      case 'csv': {
        csvWriter.write(res, result.pwas);
        break;
      }
      case 'rss': {
        rssWriter.write(req, res, result.pwas);
        break;
      }
      default: {
        jsonWriter.write(res, result.pwas);
      }
    }
  })
  .catch(err => {
    console.log(err);
    res.status(500);
    res.json(err);
  });
});

module.exports = router;
