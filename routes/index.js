const express = require('express');
const router = express.Router();
const axios = require('axios');
const redis = require('redis');
const AWS = require('aws-sdk');
require('dotenv').config();

// Redis setup

const redisClient = redis.createClient();

redisClient.on('error', (err) => {
  console.log("Error " + err);
});

// Cloud Services Set-up

// Create unique bucket name
const bucketName = 'joshuayoung-wikipedia-store';

// Create a promise on S3 service object
const bucketPromise = new AWS.S3({
  apiVersion: '2006-03-01'
}).createBucket({Bucket: bucketName}).promise();

bucketPromise.then(function(data) {
  console.log("Successfully created " + bucketName);
}).catch(function(err) {
  console.error(err, err.stack);
});

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

/* GET wikipedia entry with Redis caching and S3 storage */
router.get('/api/search', async (req, res) => {
  const query = (req.query.query).trim();

  // Construct the wiki URL
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${query}`;

  // Create the keys
  const redisKey = `wikipedia:${query}`;
  const s3Key = `wikipedia-${query}`;

  // Try the cache
  redisClient.get(redisKey, (err, result) => {
    if (result) {
      // Serve from Cache
      const responseJSON = JSON.parse(result)

      res.status(200).json(responseJSON);
    } else {
      // Check S3
      const params = { Bucket: bucketName, Key: s3Key};

      new AWS.S3({apiVersion: '2006-03-01'}).getObject(params, (err, result) => {
        if (result) {
          // Serve from S3
          const responseJSON = JSON.parse(result.Body)

          res.status(200).json(responseJSON);

          // Store in cache
          redisClient.setex(redisKey, 3600, JSON.stringify({
            source: 'Redis Cache',
            responseJSON,
          }));
        } else {
          // Serve from Wikipedia API
          axios
            .get(searchUrl)
            .then(response => {
              const responseJSON = response.data;

              res.status(200).json({
                source: 'Wikipedia API',
                responseJSON,
              });

              return responseJSON;
            })
            .then((responseJSON) => {
              // Store in cache
              redisClient.setex(redisKey, 3600, JSON.stringify({
                source: 'Redis Cache',
                responseJSON,
              }));

              // Store in storage
              const body = JSON.stringify({ source: 'S3 Bucket', responseJSON});
              const objectParams = { Bucket: bucketName, Key: s3Key, Body: body };
              const uploadPromise = new AWS.S3({apiVersion: '2006-03-01'}).putObject(objectParams).promise();

              uploadPromise.then(function(data) {
                console.log("Successfully uploaded data to " + bucketName + "/" + s3Key);
              });
            })
            .catch((err) => res.json(err));
        }
      });
    }
  })
});

/* GET wikipedia entry with S3 storage */
router.get('/api/store', (req, res) => {
  const key = (req.query.key).trim();

  // Construct the wiki URL and S3 key
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${key}`;
  const s3Key = `wikipedia-${key}`;

  // Check S3
  const params = { Bucket: bucketName, Key: s3Key};

  return new AWS.S3({apiVersion: '2006-03-01'}).getObject(params, (err, result) => {
    if (result) {
      // Serve from S3
      const resultJSON = JSON.parse(result.Body);

      return res.status(200).json(resultJSON);
    } else {
      // Serve from Wikipedia API and store in S3
      return axios.get(searchUrl)
        .then(response => {
          const responseJSON = response.data;
          const body = JSON.stringify({ source: 'S3 Bucket', ...responseJSON});
          const objectParams = {Bucket: bucketName, Key: s3Key, Body: body};
          const uploadPromise = new AWS.S3({apiVersion: '2006-03-01'}).putObject(objectParams).promise();

          uploadPromise.then(function(data) {
            console.log("Successfully uploaded data to " + bucketName + "/" + s3Key);
          });

          return res.status(200).json({ source: 'Wikipedia API', ...responseJSON, });
        })
        .catch(err => {
          return res.json(err);
        });
    }
  });
});

module.exports = router;
