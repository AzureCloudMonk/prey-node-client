var join          = require('path').join,
    base_path     = join(__dirname, '..', '..'),
    hooks         = require(join(base_path, 'hooks')),
    LatLon        = require('./lib/latlng'),
    devices       = require('./../../plugins/control-panel/api/devices')
    geo           = require('./../../providers/geo'),
    control_panel = require('./../../../agent/plugins/control-panel'),
    logger        = require('./../../common').logger.prefix('location'),
    Emitter       = require('events').EventEmitter;

var emitter,
    loc_callbacks = [],
    current   = {},
    checking  = false,
    aware_log = 'New location obtained! Making the Control Panel aware...'

var send_location = function(type, location) {
  if (type == 'control-panel') return;
  var data = {};

  if (control_panel.get_setting('location_aware')) {
    logger.info(aware_log);
    data.location = location;
  }

  devices.post_location(data, function(err, state) {
    if (err) return logger.error('Unable to notify location 1: ' + err.message);
    control_panel.update_setting('location_aware', state);    // Update location setting

    if (control_panel.get_setting('location_aware') && Object.keys(data).length == 0) {
      data = location;
      logger.info(aware_log);
      devices.post_location(data, function(err) {
        if (err) return logger.error('Unable to notify location 2: ' + err.message);
        data = {};
        return;
      });
    } else return;
  })
}

var fetch_location = function(type, callback) {
  if (callback) loc_callbacks.push(callback);
  if (checking) return;

  var done = function(err, coords) {
    if (loc_callbacks.length >= 1) {
      fire_callbacks(err, coords);
    }
    loc_callbacks = [];
    checking = false;
  }

  var fire_callbacks = function(err, coords) {
    var list = loc_callbacks;
    list.forEach(function(fn) {
      fn(err, coords);
    });
  }

  var trigger_event = function(type, new_location) {
    var event = 'new_location';

    if (Object.keys(current).length == 0) {
      current = new_location;
      done(null, current);
      send_location(type, new_location);
      return hooks.trigger(event, new_location);
    }

    var p1 = new LatLon(current.lat, current.lng);
    var p2 = new LatLon(new_location.lat, new_location.lng);
    var distance = p1.distanceTo(p2) * 1000;  // in meters

    new_location.delta = distance;

    var better_loc = function() {
      var is_better = false;
      if (!current.accuracy && !!new_location.accuracy)
        is_better = true;
      else if (!!current.accuracy && !!new_location.accuracy && new_location.accuracy < current.accuracy)
        is_better = true;
      return is_better;
    }

    if (distance >= 30 || (distance < 30 && better_loc())) {
      current = new_location;
      send_location(type, new_location);
    }

    done(null, current);
    hooks.trigger(event, new_location);
  }

  checking = true;
  geo.fetch_location(function(err, coords) {
    if (err || !coords || !emitter)
      return done(new Error('Unable to get location'));

    trigger_event(type, coords);

  });
}

exports.start = function(opts, cb) {
  hooks.on('mac_address_changed', function() {
    fetch_location('mac-address');
  });

  hooks.on('get_location', function(callback) {
    if (typeof(callback) == 'function')
      fetch_location('control-panel', callback);
    else fetch_location(callback);
  });

  fetch_location('client-start');

  emitter = new Emitter();
  cb(null, emitter);
};

exports.stop = function() {
  hooks.remove('mac_address_changed');
  hooks.remove('get_location');
  if (emitter) {
    emitter.removeAllListeners();
    emitter = null;
  }
};

exports.events = [];
