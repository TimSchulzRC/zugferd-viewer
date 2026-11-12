import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import org.mustangproject.validator.ZUGFeRDValidator;

/** HTTP wrapper around the Mustang validator: POST /validate with the file as body returns Mustang's XML report. */
public class Server {
  private static final int MAX_BYTES = 50 * 1024 * 1024;

  public static void main(String[] args) throws IOException {
    int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    server.createContext("/health", exchange -> respond(exchange, 200, "text/plain", "ok"));
    server.createContext("/validate", Server::validate);
    server.setExecutor(Executors.newFixedThreadPool(4));
    server.start();
    System.out.println("Mustang validator listening on " + port);
  }

  private static void validate(HttpExchange exchange) throws IOException {
    if (!"POST".equals(exchange.getRequestMethod())) {
      respond(exchange, 405, "text/plain", "POST only");
      return;
    }
    byte[] body = exchange.getRequestBody().readNBytes(MAX_BYTES + 1);
    if (body.length == 0 || body.length > MAX_BYTES) {
      respond(exchange, 413, "text/plain", "empty or too large");
      return;
    }
    String name = exchange.getRequestHeaders().getFirst("X-Filename");
    try {
      // A validator instance keeps per-file state, so each request gets its own.
      String report = new ZUGFeRDValidator().validate(body, name == null ? "invoice" : name);
      respond(exchange, 200, "application/xml; charset=utf-8", report);
    } catch (Throwable t) {
      t.printStackTrace();
      respond(exchange, 500, "text/plain", String.valueOf(t.getMessage()));
    }
  }

  private static void respond(HttpExchange exchange, int status, String type, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", type);
    exchange.sendResponseHeaders(status, bytes.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(bytes);
    }
  }
}
