/**
 * Inject a console proxy into the iframe window that forwards
 * console.log/warn/error/info to the parent via postMessage.
 *
 * 网络部分上报**结构化**数据（`oaw-network`），而不是像早期那样只发一行
 * 文本。原因：面板需要支持"复制请求参数""复制响应数据""复制为 cURL"，
 * 光有 `METHOD URL` 一行是做不到的。同一次请求分三段（request →
 * response → body）上报，宿主按 `networkId` 归并成一条记录。
 *
 * 三条硬约束：
 *  1. **不能影响被观测页面**：所有钩子各自 try-catch，响应体用 `clone()`
 *     读取以免消费掉调用方的流，异常一律吞掉。
 *  2. **不能泄漏凭据**：`authorization` / `cookie` / `x-api-key` 等请求头
 *     一律脱敏成 `***` 再上报——控制台内容可能被用户复制粘贴到别处。
 *  3. **不能撑爆内存**：请求/响应体各截断到 8KB，并标记 truncated。
 */
export function injectConsoleProxy(iframeWindow: Window): void {
  try {
    const script = iframeWindow.document.createElement('script');
    script.textContent = `
      (function() {
        // 防御策略:每段独立 try-catch,任何一段失败都不影响其他;
        // 不覆盖 history.pushState/replaceState(很多 userscript 也猴补丁这俩,
        // 重复 wrap 会破坏链式调用),改用 location 轮询。
        var marker = '__OAW_PROXY_INSTALLED__';
        if (window[marker]) return;
        try { Object.defineProperty(window, marker, { value: true, configurable: false }); }
        catch(e) { window[marker] = true; }

        // ── console 代理 ────────────────────────────────────────────
        try {
          var origConsole = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error,
            debug: console.debug
          };
          function stringify(args) {
            return Array.from(args).map(function(a) {
              if (a === null) return 'null';
              if (a === undefined) return 'undefined';
              if (typeof a === 'object') {
                try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); }
              }
              return String(a);
            }).join(' ');
          }
          ['log','info','warn','error','debug'].forEach(function(level) {
            var orig = origConsole[level];
            console[level] = function() {
              try { orig.apply(console, arguments); } catch(e) {}
              try {
                parent.postMessage({ type: 'oaw-console', level: level, message: stringify(arguments) }, '*');
              } catch(e) {}
            };
          });
        } catch(e) {}

        // ── 错误捕获(addEventListener 而非 onerror,避免覆盖现有 handler)──
        try {
          window.addEventListener('error', function(e) {
            try {
              parent.postMessage({
                type: 'oaw-error',
                message: String(e && e.message || 'Error'),
                filename: (e && e.filename) || '',
                lineno: (e && e.lineno) || 0
              }, '*');
            } catch(_) {}
          });
          window.addEventListener('unhandledrejection', function(e) {
            try {
              parent.postMessage({
                type: 'oaw-error',
                message: 'Unhandled Promise Rejection: ' + (e && e.reason ? String(e.reason.message || e.reason) : 'unknown'),
                filename: '',
                lineno: 0
              }, '*');
            } catch(_) {}
          });
        } catch(e) {}

        // ── 导航监听(轮询 location,避免动 history.pushState 的猴补丁)──
        try {
          var lastHref = location.href;
          var lastTitle = document.title;
          function notify(reason) {
            try {
              parent.postMessage({
                type: 'oaw-navigate',
                url: location.href,
                title: document.title || '',
                reason: reason || 'change'
              }, '*');
            } catch(e) {}
          }
          setInterval(function() {
            if (location.href !== lastHref) {
              lastHref = location.href;
              lastTitle = document.title;
              notify('poll');
            } else if (document.title !== lastTitle) {
              lastTitle = document.title;
              notify('title');
            }
          }, 500);
          window.addEventListener('popstate', function() {
            if (location.href !== lastHref) {
              lastHref = location.href;
              notify('popstate');
            }
          });
          window.addEventListener('hashchange', function() {
            if (location.href !== lastHref) {
              lastHref = location.href;
              notify('hashchange');
            }
          });
          // 初次:发送一次让 parent 知道真正的 location
          setTimeout(function() {
            try {
              parent.postMessage({
                type: 'oaw-navigate',
                url: location.href,
                title: document.title || '',
                reason: 'load'
              }, '*');
              lastHref = location.href;
              lastTitle = document.title;
            } catch(e) {}
          }, 0);
        } catch(e) {}

        // ── 网络上报工具 ────────────────────────────────────────────
        var MAX_BODY_CHARS = 8192;
        // clone().text() 会把**整个**响应读进内存再截断。对几百 KB 以上的
        // 响应来说这个代价不值得，因此先看 content-length 再决定要不要读。
        var MAX_BODY_READ_CHARS = 262144;
        var BODY_SKIPPED_HINT = '[响应体过大(>256KB),已跳过捕获]';
        var SENSITIVE_HEADERS = ['authorization','cookie','set-cookie','proxy-authorization','x-api-key','x-auth-token'];
        var reqSeq = 0;

        function isSensitiveHeader(name) {
          var lower = String(name || '').toLowerCase();
          for (var i = 0; i < SENSITIVE_HEADERS.length; i++) {
            if (lower === SENSITIVE_HEADERS[i]) return true;
          }
          return false;
        }

        function headerValue(name, value) {
          return isSensitiveHeader(name) ? '***' : String(value);
        }

        function headersToObject(headers) {
          var out = {};
          try {
            if (!headers) return out;
            if (typeof Headers === 'function' && headers instanceof Headers) {
              headers.forEach(function(v, k) { out[k] = headerValue(k, v); });
              return out;
            }
            if (Array.isArray(headers)) {
              for (var i = 0; i < headers.length; i++) {
                var pair = headers[i];
                if (pair && pair.length >= 2) {
                  var key = String(pair[0]);
                  out[key] = headerValue(key, pair[1]);
                }
              }
              return out;
            }
            if (typeof headers === 'object') {
              for (var name in headers) {
                if (!Object.prototype.hasOwnProperty.call(headers, name)) continue;
                out[name] = headerValue(name, headers[name]);
              }
            }
          } catch(e) {}
          return out;
        }

        function bodyToString(body) {
          if (body === null || body === undefined) return '';
          try {
            if (typeof body === 'string') return body;
            if (typeof URLSearchParams === 'function' && body instanceof URLSearchParams) return body.toString();
            if (typeof FormData === 'function' && body instanceof FormData) {
              var parts = [];
              try {
                body.forEach(function(v, k) { parts.push(k + '=' + (typeof v === 'string' ? v : '[File]')); });
              } catch(e) {}
              return parts.join('&');
            }
            if (typeof Blob === 'function' && body instanceof Blob) return '[Blob ' + body.size + ' bytes]';
            if (typeof ArrayBuffer === 'function' && body instanceof ArrayBuffer) return '[ArrayBuffer ' + body.byteLength + ' bytes]';
            if (typeof ArrayBuffer === 'function' && ArrayBuffer.isView && ArrayBuffer.isView(body)) {
              var typeName = (body.constructor && body.constructor.name) || 'TypedArray';
              return '[' + typeName + ' ' + body.byteLength + ' bytes]';
            }
            return JSON.stringify(body);
          } catch(e) {
            try { return String(body); } catch(_) { return ''; }
          }
        }

        function truncateBody(value) {
          var text = typeof value === 'string' ? value : '';
          if (text.length <= MAX_BODY_CHARS) return { text: text, truncated: false };
          return { text: text.slice(0, MAX_BODY_CHARS), truncated: true };
        }

        function nextNetworkId() {
          reqSeq += 1;
          return 'net-' + reqSeq + '-' + Date.now();
        }

        function postNetwork(payload) {
          try {
            payload.type = 'oaw-network';
            parent.postMessage(payload, '*');
          } catch(e) {}
        }

        /** 只对文本类响应读体;SSE 等流式响应跳过,否则会一直挂着。 */
        function isTextualContentType(ct) {
          if (!ct) return true;
          if (ct.indexOf('text/event-stream') === 0) return false;
          if (ct.indexOf('text/') === 0) return true;
          return ct.indexOf('application/json') >= 0 ||
            ct.indexOf('+json') >= 0 ||
            ct.indexOf('application/xml') >= 0 ||
            ct.indexOf('application/javascript') >= 0 ||
            ct.indexOf('application/x-www-form-urlencoded') >= 0;
        }

        function contentTypeOf(headers) {
          try {
            if (headers && typeof headers.get === 'function') {
              var value = headers.get('content-type');
              return value ? String(value).toLowerCase() : '';
            }
          } catch(e) {}
          return '';
        }

        /** content-length 超过阈值时不读体,避免为了展示 8KB 而复制整个响应。 */
        function isBodyTooLargeToRead(headers) {
          try {
            if (headers && typeof headers.get === 'function') {
              var raw = headers.get('content-length');
              var length = parseInt(raw || '', 10);
              if (!isNaN(length) && length > MAX_BODY_READ_CHARS) return true;
            }
          } catch(e) {}
          return false;
        }

        // ── fetch 钩子(检测是否已被其他扩展 wrap) ──────────────────
        try {
          var origFetch = window.fetch;
          if (typeof origFetch === 'function' && !origFetch.__oawWrapped) {
            var newFetch = function() {
              var args = Array.prototype.slice.call(arguments);
              var input = args[0];
              var init = args[1] || {};
              var method = (init.method || (input && input.method) || 'GET').toUpperCase();
              var url = typeof input === 'string' ? input : (input && input.url) || String(input);
              var startedAt = Date.now();
              var networkId = nextNetworkId();
              var requestBody = truncateBody(bodyToString(init.body));

              postNetwork({
                networkId: networkId,
                source: 'fetch',
                method: method,
                url: url,
                requestHeaders: headersToObject(init.headers),
                requestBody: requestBody.text,
                requestBodyTruncated: requestBody.truncated
              });

              return origFetch.apply(this, args).then(function(res) {
                var durationMs = Date.now() - startedAt;
                postNetwork({
                  networkId: networkId,
                  source: 'fetch',
                  method: method,
                  url: url,
                  status: res.status,
                  statusText: res.statusText || '',
                  ok: !!res.ok,
                  durationMs: durationMs,
                  responseHeaders: headersToObject(res.headers)
                });

                try {
                  if (isTextualContentType(contentTypeOf(res.headers)) && typeof res.clone === 'function') {
                    if (isBodyTooLargeToRead(res.headers)) {
                      postNetwork({
                        networkId: networkId,
                        source: 'fetch',
                        method: method,
                        url: url,
                        responseBody: BODY_SKIPPED_HINT
                      });
                    } else {
                      res.clone().text().then(function(text) {
                        var responseBody = truncateBody(text);
                        postNetwork({
                          networkId: networkId,
                          source: 'fetch',
                          method: method,
                          url: url,
                          responseBody: responseBody.text,
                          responseBodyTruncated: responseBody.truncated
                        });
                      }, function() {});
                    }
                  }
                } catch(e) {}

                return res;
              }, function(err) {
                var durationMs = Date.now() - startedAt;
                postNetwork({
                  networkId: networkId,
                  source: 'fetch',
                  method: method,
                  url: url,
                  durationMs: durationMs,
                  errorMessage: String((err && err.message) || err || 'network error')
                });
                throw err;
              });
            };
            try { newFetch.__oawWrapped = true; } catch(e) {}
            window.fetch = newFetch;
          }
        } catch(e) {}

        // ── XHR 钩子 ────────────────────────────────────────────────
        try {
          if (typeof window.XMLHttpRequest === 'function') {
            var OrigXHR = window.XMLHttpRequest;
            var origOpen = OrigXHR.prototype.open;
            var origSetRequestHeader = OrigXHR.prototype.setRequestHeader;
            var origSend = OrigXHR.prototype.send;

            if (typeof origOpen === 'function' && !origOpen.__oawWrapped) {
              var newOpen = function(method, url) {
                this.__oawMethod = method;
                this.__oawUrl = url;
                return origOpen.apply(this, arguments);
              };
              try { newOpen.__oawWrapped = true; } catch(e) {}
              OrigXHR.prototype.open = newOpen;
            }

            if (typeof origSetRequestHeader === 'function' && !origSetRequestHeader.__oawWrapped) {
              var newSetRequestHeader = function(name, value) {
                try {
                  if (!this.__oawReqHeaders) this.__oawReqHeaders = {};
                  this.__oawReqHeaders[String(name)] = headerValue(name, value);
                } catch(e) {}
                return origSetRequestHeader.apply(this, arguments);
              };
              try { newSetRequestHeader.__oawWrapped = true; } catch(e) {}
              OrigXHR.prototype.setRequestHeader = newSetRequestHeader;
            }

            if (typeof origSend === 'function' && !origSend.__oawWrapped) {
              var newSend = function(body) {
                var self = this;
                var startedAt = Date.now();
                var method = (self.__oawMethod || 'GET').toUpperCase();
                var url = String(self.__oawUrl || '');
                var networkId = nextNetworkId();
                var requestBody = truncateBody(bodyToString(body));

                postNetwork({
                  networkId: networkId,
                  source: 'xhr',
                  method: method,
                  url: url,
                  requestHeaders: headersToObject(self.__oawReqHeaders),
                  requestBody: requestBody.text,
                  requestBodyTruncated: requestBody.truncated
                });

                try {
                  self.addEventListener('loadend', function() {
                    var status = self.status || 0;
                    var payload = {
                      networkId: networkId,
                      source: 'xhr',
                      method: method,
                      url: url,
                      status: status,
                      statusText: self.statusText || '',
                      ok: status >= 200 && status < 300,
                      durationMs: Date.now() - startedAt
                    };
                    try {
                      var responseType = self.responseType;
                      if (!responseType || responseType === 'text') {
                        var text = truncateBody(self.responseText);
                        payload.responseBody = text.text;
                        payload.responseBodyTruncated = text.truncated;
                      }
                    } catch(e) {}
                    postNetwork(payload);
                  });
                } catch(e) {}

                return origSend.apply(this, arguments);
              };
              try { newSend.__oawWrapped = true; } catch(e) {}
              OrigXHR.prototype.send = newSend;
            }
          }
        } catch(e) {}
      })();
    `;
    iframeWindow.document.head.appendChild(script);
  } catch {
    // Cross-origin — can't inject
  }
}
