use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;

const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 1024 * 1024;

pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: String,
    pub body: Vec<u8>,
}

pub async fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::new();
    let header_end = loop {
        let mut chunk = [0_u8; 4096];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("read request failed: {e}"))?;
        if read == 0 {
            return Err("empty request".to_owned());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_HEADER_BYTES {
            return Err("request headers too large".to_owned());
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
    };
    let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let (method, path) = parse_request_line(&headers)?;
    let content_length = parse_content_length(&headers)?;
    if content_length > MAX_BODY_BYTES {
        return Err("request body too large".to_owned());
    }
    let body_start = header_end + 4;
    while buffer.len().saturating_sub(body_start) < content_length {
        let mut chunk = [0_u8; 4096];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("read request body failed: {e}"))?;
        if read == 0 {
            return Err("request body ended early".to_owned());
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    let body_end = body_start + content_length;
    Ok(HttpRequest {
        method,
        path,
        headers,
        body: buffer[body_start..body_end].to_vec(),
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_request_line(headers: &str) -> Result<(String, String), String> {
    let Some(line) = headers.lines().next() else {
        return Err("missing request line".to_owned());
    };
    let mut parts = line.split_whitespace();
    let Some(method) = parts.next() else {
        return Err("missing HTTP method".to_owned());
    };
    let Some(path) = parts.next() else {
        return Err("missing HTTP path".to_owned());
    };
    Ok((method.to_owned(), path.to_owned()))
}

fn parse_content_length(headers: &str) -> Result<usize, String> {
    for line in headers.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            return value
                .trim()
                .parse::<usize>()
                .map_err(|e| format!("invalid content-length: {e}"));
        }
    }
    Ok(0)
}
