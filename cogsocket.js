/******************************************************************************
CogSocket Module

This module provides the CogSocket class, which handles CogSocket communication
through a WebSocket transport.

DEBUGGING
The CogSocket object supports a 'log' property, which is undefined by default
but can be set to a message logging function to aid debugging:

cogsock.log = function(msg) {console.log(msg);}

******************************************************************************/

// Shim to support both NodeJS-style and RequireJS-style module loaders
try {
  define(define_module); // RequireJS style
} catch (ex) {
  define_module(require, exports, module); // NodeJS style
}

function define_module(require, exports, module) {

  /**
     @brief Creates a new CogSocket

     @param websocket A WebSocket that is connected to a remote CogSocket endpoint
     @param root      A root object for resolving incoming requests (optional)
     @param space     For JSON encoding, specifies an indentation number or string
     to generate indented JSON for readability (optional)
  */
  function CogSocket(websocket, root, space) {
    var self = this;

    websocket.onopen = function () {
      socketOpen.call(self);
    };
    websocket.onerror = function () {
      socketError.call(self);
    };
    websocket.onclose = function () {
      socketClose.call(self);
    };
    websocket.onmessage = function (msg) {
      socketMessage.call(self, msg);
    };

    this._priv = {
      websocket: websocket,
      root: root,
      space: space,
      requestId: 0,
      pendingRequests: {},
      listeners: {},
      eventSenders: {},
      connection: new ConnectionObject(this)
    };
  }

  module.exports = CogSocket;

  /**
     @brief Closes the socket. Has no effect if it has already been closed.
  */
  CogSocket.prototype.close = function () {
    if (this._priv) {
      this._priv.websocket.close();
      delete this._priv;
    }
  };

  /**
     @brief Sends a Get request

     @param path         The path to the resource
     @param oncomplete   A function to be called when a response is received

     @remarks The oncomplete function will be called with the property value, or
     with an Error object if an error occurs.
  */
  CogSocket.prototype.get = function (path, oncomplete) {
    // This is for convenience, allowing get to be called with the same signature as put and post i.e.
    // get(path, undefined, oncomplete)
    if (oncomplete === undefined && arguments.length > 2 && arguments[2] instanceof Function)
      oncomplete = arguments[2];

    sendRequest.call(this, "get", path, oncomplete);
  };

  /**
     @brief Sends a Put request

     @param path         The path to the resource
     @param data         The data to send
     @param oncomplete   A function to be called when a response is received (optional)

     @remarks The oncomplete function will be called with no arguments, or
     with an Error object if an error occurs. If oncomplete is null then
     no response is requested.
  */
  CogSocket.prototype.put = function (path, data, oncomplete) {
    sendRequest.call(this, "put", path, oncomplete, data);
  };

  /**
     @brief Sends a Post request

     @param path         The path to the resource
     @param data         The data to send (optional)
     @param oncomplete   A function to be called when a response is received (optional)

     @remarks The oncomplete function will be called with the return value, or
     with an Error object if an error occurs. If oncomplete is null then
     no response is requested.
  */
  CogSocket.prototype.post = function (path, data, oncomplete) {
    sendRequest.call(this, "post", path, oncomplete, data);
  };

  /**
     @brief Adds an event listener

     @param path         The path to the event
     @param listener     The listener function to be called when the event is received.
     @param oncomplete   A function to be called when a response is received (optional)
  */
  CogSocket.prototype.addListener = function (path, listener, oncomplete) {
    var priv = this._priv;
    var listeners = priv.listeners[path];
    if (listeners) {
      // Already subscribed to this event so just add a new listener
      listeners.push(listener);
    }
    else {
      // Not subscribed to this event so send a request
      priv.listeners[path] = [listener];
      sendRequest.call(this, "listen", path, oncomplete);
      return;
    }

    // We only get here if a request didn't need to be sent, in which case we just call oncomplete directly
    if (oncomplete)
      oncomplete();
  };

  /**
     @brief Removes an event listener

     @param path         The path to the event
     @param listener     The listener function that was passed to addListener, or
     null/undefined to remove all listeners for this event
     @param oncomplete   A function to be called when a response is received (optional)
  */
  CogSocket.prototype.removeListener = function (path, listener, oncomplete) {
    var priv = this._priv;
    var listeners = priv.listeners[path];
    if (listeners) {
      if (listener) {
        // Remove a specific listener (else remove all of them)
        for (var i = 0; i < listeners.length; ++i) {
          if (listeners[i] === listener) {
            listeners.splice(i, 1);
            break;
          }
        }
      }

      if (!listener || listeners.length == 0) {
        delete priv.listeners[path];
        sendRequest.call(this, "unlisten", path, oncomplete);
        return;
      }
    }

    // We only get here if a request didn't need to be sent, in which case we just call oncomplete directly
    if (oncomplete)
      oncomplete();
  };

  // Sends a new request
  function sendRequest(type, path, oncomplete, body) {
    var priv = this._priv;
    var requestId;
    if (oncomplete) {
      requestId = ++priv.requestId;
      if (requestId > 0x7FFFFFFF) {
        priv.requestId = requestId = 1;
      }

      priv.pendingRequests[requestId] = {
        requestId: requestId,
        oncomplete: oncomplete
      };
    }

    var message = {
      $type: type,
      id: requestId,
      path: path,
      body: body
    };

    var json = JSON.stringify(message, null, priv.space);

    if (this.log)
      this.log("Send " + json);

    priv.websocket.send(json);

    return requestId;
  }

  // sends a response to a received request
  function sendResponse(requestId, body) {
    if (requestId) {
      var resp = {
        $type: "resp",
        id: requestId
      };

      if (body instanceof Error) {
        resp.error = body.number ? body.number : -1;
        resp.body = body.message;
      }
      else {
        resp.body = body;
      }

      var json = JSON.stringify(resp, null, this._priv.space);

      if (this.log)
        this.log("Send " + json);

      this._priv.websocket.send(json);
    }
  }

  function socketOpen() {
    if (this.log)
      this.log("socket.onopen");
    if (this.onopen)
      this.onopen();
  }

  function socketError() {
    if (this.log)
      this.log("WebSocket.onerror");
    if (this.onerror)
      this.onerror();
  }

  function socketClose() {
    if (this.log)
      this.log("WebSocket.onclose");
    if (this.onclose)
      this.onclose();
  }

  function socketMessage(event) {
    var self = this; // use 'self' inside closures
    if (this.log)
      this.log("WebSocket.onmessage");
    var requestId = 0;
    try {
      var priv = this._priv;

      if (event.data instanceof ArrayBuffer) {
        // Binary encoding is not supported yet
        var sorry = new Uint8Array(4);
        sorry[0] = 0;
        sorry[1] = 0;
        sorry[2] = 0xE0;
        sorry[3] = 0x80;

        priv.websocket.send(sorry.buffer);
        return;
      }

      if (this.log)
        this.log("Got " + event.data);

      var message = JSON.parse(event.data);
      var path = message.path;

      if (message.$type != "resp")
        requestId = message.id;

      var parsed;
      switch (message.$type) {
      case "get":
        parsed = parsePath.call(this, path);
        var propVal = parsed.obj[parsed.prop];
        sendResponse.call(this, requestId, propVal);
        break;

      case "put":
        parsed = parsePath.call(this, path);
        parsed.obj[parsed.prop] = message.body;
        sendResponse.call(this, requestId);
        break;

      case "post":
        parsed = parsePath.call(this, path);
        var method = parsed.obj[parsed.prop];

        var returnVal;
        if (Array.isArray(message.body))
          returnVal = method.apply(parsed.obj, message.body);
        else
          returnVal = method.call(parsed.obj, message.body);

        sendResponse.call(this, requestId, returnVal);
        break;

      case "resp":
        var pending = priv.pendingRequests[message.id];
        if (pending) {
          if (pending.oncomplete) {
            if (!message.error) {
              pending.oncomplete(message.body);
            }
            else {
              var errorMessage;
              if (message.body)
                errorMessage = message.body.toString();
              else
                errorMessage = message.error.toString();
              var err = new Error(errorMessage);
              err.number = message.error;
              pending.oncomplete(err);
            }
          }
          delete priv.pendingRequests[message.id];
        }
        else {
          if (this.log)
            this.log("ERROR: Received response " + message.id + " with no pending request");
        }

        break;

      case "event":
        var eventArgs;
        if (message.body !== undefined) {
          eventArgs = Array.isArray(message.body) ? message.body : [message.body]
        }

        var listeners = priv.listeners[path];
        if (listeners) {
          for (var i = 0; i < listeners.length; ++i) {
            listeners[i].apply(this, eventArgs);
          }
        }

        if (requestId)
          sendResponse.call(this, requestId);
        break;

      case "listen":
        var sender = priv.eventSenders[path];

        if (!sender) {
          parsed = parsePath.call(this, path);
          sender = function () {
            var newEvent = {
              $type: "event",
              path: path
            };
            if (arguments.length > 0) {
              if (arguments.length == 1)
                newEvent.body = arguments[0];
              else {
                // Need to copy the 'arguments' pseudo-array into a real array for JSON.stringify
                var args = [];
                for (var a = 0; a < arguments.length; ++a)
                  args[a] = arguments[a];
                newEvent.body = args;
              }
            }
            var json = JSON.stringify(newEvent, null, priv.space);

            if (self.log)
              self.log("Send " + json);

            priv.websocket.send(json);
          };
          priv.eventSenders[path] = sender;
          parsed.obj.addListener(parsed.prop, sender);
        }

        if (requestId)
          sendResponse.call(this, requestId);
        break;

      case "unlisten":
        var sender = priv.eventSenders[path];

        if (sender) {
          parsed = parsePath.call(this, path);
          parsed.obj.removeListener(parsed.prop, sender);
          delete priv.eventSenders[path];
        }

        if (requestId)
          sendResponse.call(this, requestId);
        break;

      default:
        throw new Error("Request type '" + message.$type + "' is not supported.");
      }
    }
    catch (ex) {
      if (this.log)
        this.log("Exception while handling CogSocket message: " + ex);
      console.log(ex.stack);
      if (requestId) {
        // This was a request so send an error response
        sendResponse.call(this, requestId, ex);
      }
    }
  }

  // Parses a path
  function parsePath(path) {
    // Any path beginning with @/ is a connection-level message
    var root;
    if (path && path.substr(0, 2) == '@/') {
      root = this._priv.connection;
      path = path.substr(2);
    }
    else
      root = this._priv.root;

    if (!root)
      throw new Error("No root object is provided");

    // Remove the trailing slash, if there's one
    path = path.replace(/\/$/, "");

    // Split the path into parts with a slash separator, and get properties
    // up to the last part
    var obj = root;
    var parts = path.split('/');
    for (var i = 0; i < parts.length - 1; ++i) {
      obj = obj[parts[i]];
    }

    return { obj: obj, prop: parts[i] };
  }

  // This class handles connection-level requests
  function ConnectionObject(cogsock) {

    // Note - do not store any "private" members inside the connection object,
    // because it is exposed to the world. Any "private" members (cogsock) must
    // be captured in a closure here.

    this.hello = function (info) {
      cogsock._priv.remoteInfo = info;

      if (!cogsock._priv.localInfo) {
        cogsock._priv.localInfo = {};
        if (process) {
          // Node-like environment
          cogsock._priv.localInfo.model = process.platform;
          try {
            cogsock._priv.localInfo.name = os.hostname();
          } catch (x) {
            cogsock._priv.localInfo.name = "In-Sight?";
          }
        }
        else if (window) {
          // Browser-like environment
          cogsock._priv.localInfo.name = "Browser";    // Not generally possible to get the host computer name in a browser
          cogsock._priv.localInfo.model = "Browser";   // Possible to deduce the browser software but not easy!
        }
      }
      return cogsock._priv.localInfo;
    };

    // This prevents remote devices from modifying properties of the connection object
    Object.freeze(this);
  }

}

