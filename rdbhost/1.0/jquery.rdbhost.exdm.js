/*

 jquery.rdbhost.exdm.js

 A jquery plugin to access PostgreSQL databases on Rdbhost.com

 requires a (free) account at www.rdbhost.com to be useful.

 this module includes a class 'SQLEngine' for the database connection, and
 that class can be used by itself, aside from the plugins.  jQuery 1.4+
 is required, even when using the connection class without the plugin.


 the module adds four functions and three methods to the jQuery namespace.

 The four functions are $.rdbHostConfig, $.withResults, $.eachRecord, and
 $.postFormData.  The three methods are $.fn.populateTable,
 $.fn.populateForm, and $.fn.datadump.  There is also a $.postData alias
   to $.withResults

 $.rdbHostConfig takes an options object, and makes those options default for
   all subsequent functions and methods.

 $.withResults sends a query to the server, receives the data, and calls
   a callback with the received data.

 $.eachRecord is like $.withResults, in that it gets data from the server,
   but it extracts the rows from the data structure, and calls an eachrec
   callback for each record.  Each record is a javascript object, with a
   named attribute for each field.

 $.postFormData takes a form as input, submits that form to the server,
   receives the data returned, and provides it to the callback.
   The form fields must be named arg000, arg001, etc

 $.postData posts to the server, receives the data returned, and provides it
   to the callback.  Similar to jQuery's $.ajax()

 $.loginOpenId provides various services related to OpenID logins.  It will
   prep the form prior to submission, and handles hash values and cookies
    upon return from login process.  Call it in both the openId submit form,
   and in the follow up form.

 Form fields
 The form *must* include either a 'q' or a 'kw' field.  It may also include
 'arg###', or 'argtype###' fields.  Argument fields are numbered like
 'arg000', 'arg001'... in order.  Argument type fields, 'argtype000'.. ,
 if provided, must correspond to arg fields. Argument fields may be file
 fields.

 The 'kw' field value allows you to invoke a query that is stored in the
 'lookup.queries' table on the  server.  See website documentation for
 details.

 $.fn.populateTable sends a query to the server, receives the data, and populates
 an html table with it.  If the element provided is not a table, a new
 table is inserted in it; if the element is an empty table, it is expanded
 with new rows, one per record, and if the table has a prototype row, that
 row is duplicated once per record, and the record data is placed in
 td elements based on class name matches. (a field named 'firstName' would
 put its value in a table cell like '<td class="firstName">').  A cell
 can have multiple classes, so adding field-name classes should not interfere
 with styling.

 $.fn.populateForm sends a query to the server, receives the data, selects the
 first record, and populates a form with it.  It attempts to match each field
 name to an input field with matching id, and then attempts to match an input
 field with matching class-name.

 $.fn.datadump is a diagnostic-aid that puts a formatted json-string of
 the data into the selected html elements.  It allows you to verify the
 data retrieval functionality before doing (much) html work.

 */

/*
 logging
 */
function consoleLog(msg) {
  window.console.log(msg);
}

(function ($, window) {

  // isolate each easyXDM in its own namespace
  var CONNECTIONS = {};

  var indexName = easyXDM.Debug ? 'index.debug.html' : 'index.html',
      receiverName = easyXDM.Debug ? 'receiver_debug.html' : 'receiver.html';


  function createConnection(username, domain) {

    var uid = username.substring(1),
        REMOTE = 'https://' + domain;

    assert(!CONNECTIONS[uid], 'repeated namespace creation');
    CONNECTIONS[uid] = {};

    // ajaxRpc object is created one time, used by .SQLEngine.query() method
    CONNECTIONS[uid].ajaxRpc = new easyXDM.Rpc({
          local: "/static/~/easyxdm/name.html".replace('~', uid),
          swf: "/js/easyxdm/easyxdm.swf",
          remote: REMOTE + ("/static/~1/easyxdm/cors/~2".replace('~1', uid).replace('~2', indexName)),
          remoteHelper: REMOTE + ("/static/~/easyxdm/name.html".replace('~', uid)),
          onReady: function () {
            CONNECTIONS[uid].ajaxRpcReady = true;
          }
        }, {
          remote: {
            request: {}
          }
        }
    );

    // remote rpc created for use by .queryByForm() method
    CONNECTIONS[uid].remoteRpc = new easyXDM.Rpc({
          remote: REMOTE + "/static/~1/~2".replace('~1', uid).replace('~2', receiverName),
          swf: REMOTE + "/js/easyxdm/easyxdm.swf",
          remoteHelper: REMOTE + "/static/~/easyxdm/name.html".replace('~', uid),
          onReady: function () {
            CONNECTIONS[uid].remoteRpcReady = true;
          }
        }, {
          local: { 
            returnResponse: function (tag, response) {
              CONNECTIONS[uid].handler(tag, response);
            }
          },
          remote: {
            createTargetIframe: {}
          }
        }
    );

    CONNECTIONS[uid].handlerHash = {};
    CONNECTIONS[uid].handler = function(tag, msg) {
      if ( !CONNECTIONS[uid].handlerHash[tag] )
        CONNECTIONS[uid].handlerHash[tag](msg);
      else
        console.log('no response handler found for '+tag);
    };

    return uid;
  }

// SQL Engine that uses form for input, and hidden iframe for response
//   handles file fields
//
  function SQLEngine(userName, authcode, domain) {

    this.version = 'jquery.rdbhost.exdm.js 0.9.0';

    // store engine config info
    var remote = 'https://' + domain,
        easyXDMAjaxHandle;

    if (!domain) {
      domain = 'www.rdbhost.com';
    }

    // function to clean up entry forms - used by .queryByForm method
    function cleanup_form($form, target, action) {

      $form.find('.to-remove-later').remove();
      $form.attr('target', target);
      $form.attr('action', action);
    }

    // to add hidden field to form - used by .queryByForm method
    function add_hidden_field($form, nm, val) {

      var fld = $('<input type="hidden" class="to-remove-later" />');
      fld.attr('name', nm).val(val);
      $form.append(fld);
    }

    // for setting auth info later
    this.setUserAuthentication = function(uName, aCode) {

      userName = uName;
      authcode = aCode;

      easyXDMAjaxHandle = userName.substring(1);
      if (CONNECTIONS[easyXDMAjaxHandle] === undefined) {
        createConnection(userName, domain);
      }
    };

    this.hasUserAuthentication = function() {

      return userName && userName.length && authcode && authcode.length;
    };

    this.userName = function() {
      return userName;
    };

    if ( userName && userName.length > 2 ) {
          this.setUserAuthentication(userName, authcode);
    }

    /*
     Return API type for data item.

     return value is one of STRING, NUMBER, DATE, NONE, DATETIME, TIME
     */
    function apiType(d) {

      switch (typeof d) {

        case 'number':
          return 'NUMBER';
        case 'object':
          if ($.type(d) == 'date')
            return 'DATETIME';
          else
            return 'STRING';
        case 'undefined':
          return 'NONE';

        default:
          return 'STRING'
      }
    }

    // return appropriate /db/ url for action attribute in form
    this.getQueryUrl = function (altPath) {
      if (altPath === undefined) {
        assert(userName,'no username in sqlEngine');
        assert(userName.length,'username is null in sqlEngine');
        altPath = '/db/' + userName;
      }
      return remote + altPath;
    };

    // return appropriate /accountlogin/ url for action attribute in form
    this.getLoginUrl = function () {
      assert(userName,'no username in sqlEngine');
      assert(userName.length > 1,'username is too short in sqlEngine');
      return this.getQueryUrl('/accountlogin/'+userName.substring(1));
    };


    /*
     parms is object containing various options

     callback : function to call with data from successful query
     errback : function to call with error object from query failure

     q : the query string itself

     args : array of arguments (optional), must correspond with %s tokens
        in query
     namedParams : an object containing arguments, by name. Reference
        in query with tokens like %(name)

     format : 'json' or 'json-easy'
     plainTextJson : true if JSON parsing to be skipped, instead
        returning the JSON plaintext
     */
    this.query = function(parms) {

      var that = this;
      return _query(parms, function() { return that.getQueryUrl() });
    };

    function _query(parms, urlFunc) {

      var errback = parms.errback,
          args = parms.args || [],
          namedParams = parms.namedParams || {},
          defer = $.Deferred(),
          formatType = 'json',
          fmt = parms.format || '',
          that = this,
          nm, typNm;

      var data = {
        q: parms.q,
        kw: parms.kw,
        format: ~fmt.toLowerCase().indexOf('easy') ? formatType+'-easy' : formatType,
        mode: parms.mode,
        authcode: parms.authcode || authcode
      };

/*
      // define default errback
      if (errback === undefined) {
        errback = function () {
          var arg2 = Array.apply(null, arguments);
          alert(arg2.join(', '));
          return arg2;
        };
      }
*/

      // attach provided handlers (if any) to deferred
      //
      parms.callback = parms.callback || null;
      var deferOut = defer.then(parms.callback, errback);

      // if params are provided, convert to named form 'arg000', 'arg001'...
      if (args !== undefined) {
        for (var i = 0; i < args.length; i += 1) {

          var num = '000' + i;
          nm = 'arg' + num.substr(num.length - 3);
          data[nm] = args[i];
          typNm = 'argtype' + num.substr(num.length - 3);
          data[typNm] = apiType(args[i]);
        }
      }

      // if cookie tokens found in sql, convert to namedParams
      var ckTestRe = /%\{([^\}]+)\}/;
      if ( namedParams === undefined )
        namedParams = {};

      while ( ckTestRe.test(data.q) ) {

        var ckArray = ckTestRe.exec(data.q),
            ck = ckArray[0],
            ckV = ckArray[1],
            newNm = '_ck_'+ckV,
            ckValue = $.cookie(ckV);
        data.q = data.q.replace(ck,'%('+newNm+')');
        namedParams[newNm] = ckValue;
      }

      // if keyword params are provided, convert to named form 'arg:name'.
      if (namedParams !== undefined) {
        for (var kw in namedParams) {
          if (namedParams.hasOwnProperty(kw)) {

            nm = 'arg:' + kw;
            data[nm] = namedParams[kw];
            typNm = 'argtype:' + kw;
            data[typNm] = apiType(namedParams[kw]);
          }
        }
      }

      var url = urlFunc();

      // make request using previously prepared connection
      //
      CONNECTIONS[easyXDMAjaxHandle].ajaxRpc.request({
            url: url,
            method: "POST",
            data: data
          },

          function (resp) {
            // success handler
            if (!parms.plainTextJson) {
              try {
                resp.data = JSON.parse(resp.data);
              }
              catch (e) {
                defer.reject('json-parse', resp.data);
                return;
              }
              if (resp.data.status[0] == 'error') {
                defer.reject(resp.data.error[0], resp.data.error[1]);
              }
              else {
                defer.resolve(resp.data);
              }
            }
            else {
              defer.resolve(resp);
            }
          },

          function (errObj) {
            // error handler
            defer.reject(errObj.message, errObj.data);
          }
      );

      // return promise object from deferred, so client can add additional handlers
      //  as necessary
      return deferOut.promise();
    }

    /*
     parms is just like for query method, but callback gets row array and
     header array, not whole data structure.
     an additional param is 'incomplete', a function that is called
     (with rows and header) when data set is truncated by 100 record limit
     */
    this.queryRows = function (parms) {

      var callback = parms.callback,
          incomplete_callback = parms.incomplete || callback;

      function cb(json) {
        var rows = json.records.rows || [],
            status = json.status[0],
            header = json.records.header || [];
        if (status === 'complete') {
          callback(rows, header);
        }
        else if (status === 'incomplete') {
          incomplete_callback(rows, header);
        }
      }

      parms.callback = cb;
      return this.query(parms);
    };


    /* parms is object containing various options

     formId : the id of the form with the data

     callback : function to call with data from successful query
     errback : function to call with error object from query failure

     plainTextJson : true if JSON parsing to be skipped, instead
     returning the JSON plaintext

     call this prior to form click, not from click handler.
     */
    this.queryByForm = function (parms) {

      var errback = parms.errback,
          formId = parms.formId,
          plainTextJson = parms.plainTextJson,
          defer = $.Deferred(),
          formatType = 'json-exdm',
          authCode = parms.authcode || authcode,
          that = this;

      // internal callback function
      function cBack(response) {

        if (!plainTextJson) {

          try {
            response = JSON.parse(response);
          }
          catch (e) {
            //delete CONNECTIONS[easyXDMAjaxHandle].handler;
            defer.reject('json parse', response);
            return;
          }

          if (response.status[0] == 'error') {
            //delete CONNECTIONS[easyXDMAjaxHandle].handler;
            defer.reject(response.error[0], response.error[1]);
          }
          else {
            //delete CONNECTIONS[easyXDMAjaxHandle].handler;
            defer.resolve(response);
          }

        }

        else {
          //delete CONNECTIONS[easyXDMAjaxHandle].handler;
          // plaintext response
          defer.resolve(response);
        }
      }

      //CONNECTIONS[easyXDMAjaxHandle].handler = cBack;

      var fmt = parms.format || '';
      parms.format = ~fmt.toLowerCase().indexOf('easy') ? formatType+'-easy' : formatType;
      assert(~parms.format.indexOf('xdm'),'bad format '+parms.format);

      // get form, return if not found
      var $form = $('#' + formId);
      if ($form.length < 1) {
        return false;
      }

      $form.attr('target','');
      // var targettag = 'request_target_' + userName.substring(1);
      CONNECTIONS[easyXDMAjaxHandle].remoteRpc.createTargetIframe(

          function (targettag) {

            // init vars
            var dbUrl = that.getQueryUrl();

            // save vals
            var target = $form.attr('target'),
                action = $form.attr('action');

            // put password into form
            add_hidden_field($form, 'authcode', authCode);
            // set format, action, and target
            add_hidden_field($form, 'format', parms.format);

            $form.attr('target', targettag);
            $form.attr('action', dbUrl);

            $form.submit(function() {
              CONNECTIONS[easyXDMAjaxHandle].handlerHash[targettag] = cBack;
            })
          }
      );

      // set errback on deferred
      var deferOut = defer.then(parms.callback || null, parms.errback || null);

      // return promise, so client can add callbacks/errbacks as required
      //
      return deferOut.promise();
    };



    /*
     following section defines some jQuery plugins

     */

    /*
     parms is object containing various options

     email :
     password :

     callback : function to call with data from successfull query
     errback : function to call with error object from query failure

     plainTextJson : true if JSON parsing to be skipped, instead
     returning the JSON plaintext
     */
    this.loginAjax = function (parms) {

      var email = parms.email,
          password = parms.password,
          that = this;
      delete parms.email; delete parms.password;
      parms.namedParams = { email: email,  password: password };
      parms.format = 'json-easy';

      return _query(parms, function() { return that.getLoginUrl(); });
    }

  } // end of SQLEngine class

  // export SQLEgnine
  window.SQLEngine = SQLEngine;


  // default generic callbacks
  //
  function errback(err, msg) {
    var errCode = '-';

    try { errCode = err.toString() }
    catch (e) {}

    alert('<pre>' + errCode + ': ' + msg + '</pre>');
  }

  function dumper(json) {
    var str = JSON.stringify(json, null, 4);
    alert(str);
  }

  //  configuration setting function
  //  saves defaults as attribute on the config function
  //
  var opts = {
      errback: errback,
      callback: dumper,
      eachrec: undefined,
      domain: 'www.rdbhost.com',
      mode: undefined,
      format: 'json-easy',
      userName: '',
      authcode: ''        };


  $.rdbHostConfig = function (parms) {

    $.rdbHostConfig.opts = $.extend({}, opts, parms || {});
  };


  /*
   withResults - calls callback with json result object
      or errback with error object

   param q : query to get data

   param callback : function to call with json data
   param errback : function to call in case of error
   */
  $.withResults = function (parms) {

    assert(arguments.length <= 1, 'too many parms to withResults');
    var inp = $.extend({}, $.rdbHostConfig.opts, parms || {});

    try {

      var sqlEngine = new SQLEngine(inp.userName, inp.authcode, inp.domain);
      var promise = sqlEngine.query(inp);
    }
    catch (e) {

      inp.errback(e.name, e.message);
    }

    return promise; // return promise
  };


  /*
   eachRecord - calls 'eachrec' callback with each record,
     or errback with error object

   param q : query to get data

   param eachrec : function to call with each record
   param errback : function to call in case of error
   */
  $.eachRecord = function (parms) {

    assert(arguments.length <= 1, 'too many parms to eachRecord');
    assert(parms.eachrec, 'eachrec not provided');

    var eachrec = parms.eachrec;
    delete parms.eachrec;

    function cback(json) {

      for (var r in json.records.rows) {
        eachrec(json.records.rows[r]);
      }
    }

    parms.callback = cback;
    var promise = $.withResults(parms);

    return promise;
  };


  /*
   postFormData should be called on a form BEFORE form is submitted.

   that: id of form, or id of form element
   param q : query to post data
   param kw : query-keyword to post data
   */
  $.postFormData = function (that, parms) {

    assert(arguments.length <= 2, 'too many parms to postFormData');
    var $form = $(that).closest('form'),
        inp = $.extend({}, $.rdbHostConfig.opts, parms || {});

    inp.formId = $form.attr('id');
    assert(inp.formId, 'form must have a unique id attribute');

    if (inp.q) {

      $form.find('#kw').remove();
      $form.find('#q').remove();
      $form.append($('<input type="hidden" id="q" name="q" >').val(inp.q));
    }

    if (inp.kw) {

      $form.find('#kw').remove();
      $form.find('#q').remove();
      $form.append($('<input type="hidden" id="kw" name="kw" >').val(inp.kw));
    }

    try {

      var sqlEngine = new SQLEngine(inp.userName, inp.authcode, inp.domain);
      //delete inp.userName; delete inp.authcode; delete inp.domain;
      var promise = sqlEngine.queryByForm(inp);
    }
    catch (e) {

      inp.errback(e.name, e.message);
    }

    return promise;
  };



  /*
   postData submits some data (in the options object) to the server
   and provides the response to callback.

   param q : query to post data
   param kw : query-keyword to post data
   */
  $.postData = $.withResults;


  /*
   * loginOpenId - handles login functionality, including processing auth info passed in
   *   the hash string, or auth info in cookie named 'OPENID_KEY'.
   *
   *   Creates login cookie of client chosen name, with auth key returned from rdbhost server.
   *   Calls the success function with (key, identifier), or failure function with (identifier).
   *   The identifier and key are a pair in the table auth.openid, and the key can be submitted
   *     with queries that join the auth.openid table for authentication of the query.
   *
   *   If provided a form#id, will prepare form with appropriate action line.
   *     bases url on www.rdbhost.com if on localhost, else uses same domain
   *
   *   The function takes an options object with the following options:
   *
   *   acctNum: account number of Rdbhost account - MANDATORY
   *
   *   callback: function of sig funct(key, identifier) -- default uses alert
   *   errback: function with sig funct(identifier)  -- default uses alert
   *
   *   cookieName: name of new cookie to receive key value  -- default LOGIN_KEY
   *   ignoreHash: set true to ignore url#hash value, and rely only on OPENID_KEY cookie  -- default false
   *
   *   loginForm: id of form to prepare -- default 'openidForm'
   *   returnPath: complete url or absolute path of page to end process at  -- default current page
   *
   *   offsiteHosting: indicate to library that static pages not on rdbhost. Uses 'www.rdbhost.com' for openid
   *      negotiation
   *
   *
   */
  $.loginOpenId = function (inp) {

    // minimal functions for success and failure handlers
    var onSuccess = function () {
      alert('success!');
    };

    var onFailure = function () {
      // default is to fail silently
    };

    /*
     * default values for each attribute
     *
     *   each can be overridden, only mandatory item is acctNum
     */
    var parms = {

      loginForm: 'null',
      returnPath: false,

      callback: onSuccess,
      errback: onFailure,

      cookieName: 'LOGIN_KEY',
      ignoreHash: false,

      offsiteHosting: false
    };

    parms = $.extend({}, $.rdbHostConfig.opts, parms, inp);

    // get cookie, if available
    var loginCookie = $.cookie('OPENID_KEY');

    var ident, key;

    /*
     * function prepare form, creating action attribute
     */
    function prepareForm($inputForm, offsite) {

      if (parms.returnPath === false) {
        parms.returnPath = window.location.pathname;
        if (parms.returnPath.substr(0, 1) !== '/')
          parms.returnPath = '/' + parms.returnPath;
      }

      if (/localhost/i.test(window.location.hostname) || offsite) {

        parms.hostname = parms.domain;
        parms.returnPath = window.location.origin + parms.returnPath;
      }
      else {
        parms.hostname = window.location.hostname;
      }

      var acctNum = ('0000000000' + parms.userName);
      acctNum = acctNum.substr(acctNum.length - 10, 10);

      var action = 'https:' + '//' + parms.hostname + '/auth/openid/' + acctNum + '/one?' + parms.returnPath;
      $inputForm.attr('action', action);

      /*
       * add click handlers to host specific buttons
       */
      var $inputFld = $('[name="openidurl"]', $inputForm);
      $('#google', $inputForm).click(function (ev) {

        ev.stopPropagation();
        $inputFld.val('https://www.google.com/accounts/o8/id');
        $inputForm.submit();
      });

      $('#yahoo', $inputForm).click(function (ev) {

        ev.stopPropagation();
        $inputFld.val('https://me.yahoo.com');
        $inputForm.submit();
      });


    }

    /*
     *  function to extract ident and key from hash
     */
    function useHash() {

      if (window.location.hash) {
        var hash = window.location.hash;
        window.location.hash = '';
        hash = decodeURIComponent(hash);
        var hp = hash.split('&', 2);
        if (hp.length >= 2) {
          ident = hp[0];
          key = hp[1];
          if (ident.indexOf('#') === 0)
            ident = ident.substr(1);
          $.cookie(parms.cookieName, key);
          return true;
        }
        else
          return false;
      }
      else
        return false;
    }

    /*
     * function to extract ident and key from temporary auth cookie
     */
    function useCookie() {

      if (loginCookie) {
        var kp = loginCookie.split('&', 2);
        if (kp.length >= 2) {
          ident = kp[0];
          key = kp[1];
          $.cookie(parms.cookieName, key);
          return true;
        }
        else {
          return false;
        }
      }
      else
        return false;
    }

    /*
     *   start processing of available inputs
     */
    var loggedInSuccess = false;
    if (!parms.ignoreHash) {

      var ckSuccess;
      var hashSuccess = useHash();
      if (!hashSuccess) {
        ckSuccess = useCookie();
        if (!ckSuccess)
          parms.errback(ident);
        else {
          parms.callback(key, ident);
          loggedInSuccess = true;
        }
      }
      else {
        parms.callback(key, ident);
        loggedInSuccess = true;
      }
    }
    else {
      ckSuccess = useCookie();
      if (!ckSuccess)
        parms.errback(ident);
      else {
        parms.callback(key, ident);
        loggedInSuccess = true;
      }
    }

    // prepare form for login try
    var $inputForm = $('#' + parms.loginForm);

    if ($inputForm.length) {
      prepareForm($inputForm, parms.offsiteHosting);
    }
  };



  /*
   loginAjax submits login info, gets list of roles/authcodes

   */
  $.loginAjax = function(parms) {

    var inp = $.extend({}, $.rdbHostConfig.opts, parms||{});

    var sqlEngine = new SQLEngine(inp.userName, inp.authcode, inp.domain);
    delete inp.userName; delete inp.authcode; delete inp.domain;

    return sqlEngine.loginAjax(inp);
  };



  /*
    rdbhostSubmit is .submit() but waits for cross-domain socket to be ready

    Use in lieu of $('#formid').submit(), where form has been prepared with
    $.postFormData or $.loginByForm
    */
  $.fn.rdbhostSubmit = function () {

    var $that = this,
        targetName = $that.attr('target'),
        reqPrefix = 'request_target_';

    if (targetName && targetName.substr(0, reqPrefix.length) === reqPrefix) {

      var uid = targetName.substr(targetName.length-10);

      if (CONNECTIONS[uid].remoteRpcReady) {
        $that.submit();
      }
      else {
        setTimeout(function () {
          $that.rdbhostSubmit();
        }, 50);
      }
    }
    else {
      setTimeout(function () {
        $that.rdbhostSubmit();
      }, 50);
    }

  };


  /*
   populateTable creates an html table and inserts into  page

   param q : query to get data
   */
  $.fn.populateTable = function (parms) {

    assert(arguments.length <= 1, 'too many parms to populateTable');
    var $selset = this;

    if (typeof(parms) === 'string') {
      parms = { 'q': parms };
    }

    function populate_html_table($table, $row, recs) {

      var rec, $newrow;
      $table.find('tbody').empty();

      if (recs === undefined || recs.length === 0) {

        $newrow = $row.clone();
        $table.append($newrow);
      }
      else {

        for (var r in recs) {

          rec = recs[r];
          $newrow = $row.clone().show();
          var ctr = 0, flds = [];

          for (var fname in rec) {

            $newrow.find('td.' + fname).html(rec[fname]);
            ctr += $newrow.find('td.' + fname).length;
            flds.push(fname);
          }

          assert(ctr, 'no td elements found with field names! ' + flds.join(', '));
          $table.append($newrow);
        }
      }
    }

    function generate_html_table($table, recs) {

      var rec, $row, $td, fld;
      for (var r in recs) {

        rec = recs[r];
        $row = $('<tr>');
        for (var o in rec) {

          fld = rec[o];
          $td = $('<td>').html(fld);
          $row.append($td);
        }

        $table.append($row);
      }
    }

    function cback(json) {

      var recs = json.records.rows;

      $selset.each(function () {

        var $table = $(this);
        assert(!$table.is('form'), 'use .populateForm for forms');

        if (!$table.is('table')) {

          $table.empty().append('<table><tbody></tbody></table>');
          $table = $table.find('table');
          generate_html_table($table, recs);
        }

        else if ($table.find('tbody tr:first').length) {

          var $row = $table.find('tbody tr:first').hide();
          populate_html_table($table, $row, recs);
        }
        else {

          generate_html_table($table, recs);
        }
      });
    }

    parms.callback = cback;
    $.withResults(parms);

    return $selset;
  };


  /*
   populateForm populates a form with a single record

   param q : query to get data
   */
  $.fn.populateForm = function (parms) {

    assert(arguments.length <= 1, 'too many parms to populateForm');
    var $selset = this;

    if (typeof(parms) === 'string') {
      parms = { 'q': parms };
    }

    function populate_form($form, rec) {
      for (var f in rec) {
        var $inp = $form.find('input#' + f);
        if ($inp.length) {
          $inp.val(rec[f]);
        }
        else {
          $inp = $form.find('input.' + f);
          $inp.val(rec[f]);
        }
      }
    }

    function cback(json) {
      if (json.records.rows.length) {
        var rec = json.records.rows[0];
        $selset.each(function () {
          var $form = $(this);
          assert($form.is('form'), 'use .populateForm on a form');
          populate_form($form, rec);
        });
      }
    }

    parms.callback = cback;
    $.withResults(parms);
    return $selset;
  };


  /*
   datadump puts a <pre>-formatted json dump into the html

   param q : query to get data
   param kw : query-keyword to get data
   */
  $.fn.datadump = function (parms) {

    var $selset = this;

    if (typeof(parms) === 'string') {
      parms = { 'q': parms };
    }

    function cback(json) {

      $selset.each(function () {
        $(this).html(JSON.stringify(json, null, 4)); // 4 space indent
      });
    }

    parms.callback = cback;
    $.withResults(parms);
    return $selset;
  };

  /* create assert function
   example : assert( obj === null, 'object was not null!' );
   error message appears in javascript console, if any.
   credit to: Ayman Hourieh http://aymanh.com/
   */
  function AssertException(message) {
    this.message = message;
  }
  AssertException.prototype.toString = function () {
    return 'AssertException: ' + this.message;
  };
  function assert(exp, message) {
    if (!exp) {
      throw new AssertException(message);
    }
  }

}(jQuery, window));



