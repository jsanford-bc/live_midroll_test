var Promise        = require('bluebird');
var express        = require('express');
var bodyParser     = require('body-parser');
var methodOverride = require('method-override');
var util           = require('util');
var _              = require('lodash');
var Asset          = Promise.promisifyAll(require('./models/asset.js'));
var app            = express();
var server         = require('http').Server(app);
var io             = require('socket.io')(server);
var Datastore      = require('nedb');
var rp             = require('request-promise');
var config         = require('./config');
var exec           = require('child_process').exec;

// Set up Express middlewares
var pub = __dirname + '/public';
app.use(express.static(pub));
app.use(bodyParser.json());
app.use(methodOverride());

var routes = {};
routes.index = function(req, res) {
  res.status(200).send('Woo');
};

routes.getUrl = function(req, res) {
  // see if we have the asset already
  Asset.findByIdAsync('live_asset').then(function(asset) {
    // if we have one and it's live, just pass that on
    if (asset) {
      return Asset.findByIdAsync(asset._id);
    }
    // otherwise, we need a new one
    else {
      return Asset.createAsync({ id: 'live_asset', url: 'http://foo.bar/master.m3u8' });
    }
  }).then(function(asset) {
    // if it's live, just pass it on
    if (asset.state === 'live' || asset.state === 'waiting') {
      return Asset.findByIdAsync(asset._id);
    }
    // otherwise, need to create the Zencoder job
    else {
      var createTimestamp = Date.now();
      var zcBody = {
        "live_stream": "true",
        "metadata_passthrough": "true",
        "region":"us-n-california",
        "outputs": [
          {
            "label": "hls_300",
            "size": "480x270",
            "video_bitrate": 300,
            "audio_bitrate": 64,
            "url": "",
            "type": "segmented",
            "live_stream": "true",
            "metadata_passthrough": "true",
            "headers": { "x-amz-acl": "public-read" }
          },
          {
            "label": "hls_600",
            "size": "640x360",
            "video_bitrate": 600,
            "audio_bitrate": 64,
            "url": "",
            "type": "segmented",
            "live_stream": "true",
            "metadata_passthrough": "true",
            "headers": { "x-amz-acl": "public-read" }
          },
          {
            "label": "hls_1200",
            "size": "1280x720",
            "video_bitrate": 1200,
            "audio_bitrate": 64,
            "url": "",
            "type": "segmented",
            "live_stream": "true",
            "metadata_passthrough": "true",
            "headers": { "x-amz-acl": "public-read" }
          },
          {
            "label": "master",
            "url": "master.m3u8",
            "type": "playlist",
            "streams": [
              {
                "bandwidth": 450,
                "path": "hls_300/index.m3u8"
              },
              {
                "bandwidth": 800,
                "path": "hls_600/index.m3u8"
              },
              {
                "bandwidth": 1500,
                "path": "hls_1200/index.m3u8"
              }
            ],
            "headers": { "x-amz-acl": "public-read" }
          }
        ]
      };

      // modify the outputs so we have new streams
      zcBody.outputs = _.map(zcBody.outputs, function(output) {
        if (output.label === "master")
          output.url = 's3://bc-jsanford/id3-test/' + createTimestamp + '/master.m3u8';
        else
          output.url = 's3://bc-jsanford/id3-test/' + createTimestamp + '/' + output.label + '/index.m3u8';
        return output;
      });

      // set up our request
      var rpOptions = {
        uri: 'https://app.zencoder.com/api/v2/jobs',
        headers: {
          "Zencoder-Api-Key": config.zencoder_api_key
        },
        method: 'POST',
        json: true,
        body: zcBody
      };

      // make the request, and then update the asset (and return the promise for that asset update)
      return rp(rpOptions).then(function(response) {
        // do the whole live streaming asynchronously
        setTimeout(pollJob, 1000, response.id);
        startLiveStream(response.stream_url + '/' + response.stream_name);

        console.log(_.find(response.outputs, {label: "master"}));

        return Asset.updateAsync(asset._id, { 
          zencoder_response: response, 
          url: _.result(_.find(response.outputs, {label: "master"}), 'url'),
          state: 'waiting' 
        });
      });
    }
  }).then(function(asset) {
    // return the URL if it's truly live
    if (asset.state === 'live')
      return res.status(200).send(asset.url);
    // otherwise, tell it to try again
    else
      return res.status(204).send('Retry');
  }).catch(function(e) {
    console.error(e, e.stack);
    res.status(500).send('Something went wrong');
  });;
}

// polls the job that's running, to check for when the job is actually processing
function pollJob(id) {
  var rpOptions = {
    uri: 'https://app.zencoder.com/api/v2/jobs/' + id + '/progress.json?api_key=' + config.zencoder_api_key,
    method: 'GET'
  };

  rp(rpOptions).then(function(response) {
    response = JSON.parse(response);
    if (response.state === 'processing') {
      // update the asset, then once updated, start the process to inject cue points
      Asset.updateAsync('live_asset', { state: 'live' }).then(function(asset) {
        setTimeout(injectCuePoint, 60000, id, asset);
      });
    }
    else
      setTimeout(pollJob, 2000, id);
  });
}

// every minute, injects an ad cue point, until the stream is no longer active
function injectCuePoint(id, asset) {
  Asset.findByIdAsync(asset._id).then(function(asset) {
    // make sure we're still live
    if (asset.state === 'live') {
      console.log('injecting cue point');
      // the ad cue
      var adCue = {
        name: "adCue",
        time: "30",
        type: "event",
        parameters: {
          duration: "30",
          customKey: "test"
        }
      };
      
      // create our request
      var rpOptions = {
        uri: 'https://app.zencoder.com/api/v2/jobs/' + id + '/cue_point',
        headers: {
          "Zencoder-Api-Key": config.zencoder_api_key,
          "Content-Type": "application/json"
        },
        method: 'POST',
        json: true,
        body: adCue
      };

      // make the actual reqeust
      rp(rpOptions).then(function(response) {
        setTimeout(injectCuePoint, 60000, id, asset);
      });
    }
    // otherwise, we just exit gracefully
  });
}

// start the actual live stream, and when it's done, clean up
function startLiveStream(url) {
  // var ffmpegCmd = 'ffmpeg -re -y -i /Users/jsanford/Movies/BC/high_version.mp4 -vcodec copy -acodec copy -f flv ';
  // var ffmpegCmd = 'ffmpeg -re -y -i /Users/jsanford/Movies/BC/big_buck_bunny_1080p_h264.mov -vcodec copy -acodec copy -f flv ';
  var ffmpegCmd = 'ffmpeg -re -y -i /Users/jsanford/projects/dev/live_midroll_test/hour_no_audio.mp4 -vcodec copy -acodec copy -f flv > /dev/null 2>&1 ';
  ffmpegCmd += '"' + url + '"';
  var ffmpeg = exec(ffmpegCmd, function(error, stdout, stderr) {
    if (error !== null)
      console.log('exec error: ' + error);
  });

  // on error, change the state to error
  ffmpeg.addListener('error', function(evt) {
    console.log('error streaming');
    Asset.updateAsync('live_asset', { state: 'error' });
  });

  ffmpeg.addListener('exit', function(evt) {
    // we're done
    console.log('stream done');
    Asset.updateAsync('live_asset', { state: 'done' });
  });
}

app.get('/', routes.index);
app.get('/url', routes.getUrl);

// Start this party
server.listen(3000, function() {
  console.log('Listening on port %d', server.address().port);
});