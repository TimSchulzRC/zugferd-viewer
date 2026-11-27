import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import javax.xml.parsers.SAXParserFactory;
import javax.xml.transform.sax.SAXSource;
import javax.xml.transform.stream.StreamSource;
import net.sf.saxon.s9api.Processor;
import net.sf.saxon.s9api.XdmDestination;
import net.sf.saxon.s9api.XdmItem;
import net.sf.saxon.s9api.XdmNode;
import net.sf.saxon.s9api.XPathCompiler;
import net.sf.saxon.s9api.Xslt30Transformer;
import net.sf.saxon.s9api.XsltExecutable;
import org.mustangproject.validator.ZUGFeRDValidator;
import org.xml.sax.InputSource;
import org.xml.sax.XMLReader;

/**
 * HTTP wrapper around the Mustang validator: POST /validate with the file as body returns Mustang's XML report.
 * For UBL invoices the report gets a <peppol> section with the Peppol BIS Billing rules, which Slovakia requires.
 */
public class Server {
  private static final int MAX_BYTES = 50 * 1024 * 1024;

  private static final String UBL_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
  private static final String UBL_CREDIT_NOTE = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";
  private static final String SELF_BILLING = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0";
  /** Peppol BIS Billing 3.1.0, the first release with the Slovak rules SK-R-001 to SK-R-007. See the Dockerfile. */
  private static final String PEPPOL_RULES = "Peppol BIS Billing 3.1.0 (2026.11)";

  private static final Processor SAXON = new Processor(false);
  private static final XsltExecutable PEPPOL = compile("rules/PEPPOL-EN16931-UBL.xslt");
  private static final XsltExecutable PEPPOL_SELF_BILLING = compile("rules/PEPPOL-EN16931-UBL-SB.xslt");

  public static void main(String[] args) throws IOException {
    int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    server.createContext("/health", exchange -> respond(exchange, 200, "text/plain", "ok"));
    server.createContext("/validate", Server::validate);
    server.setExecutor(Executors.newFixedThreadPool(4));
    server.start();
    System.out.println("Mustang validator listening on " + port);
  }

  private static XsltExecutable compile(String path) {
    try {
      return SAXON.newXsltCompiler().compile(new StreamSource(new File(path)));
    } catch (Exception e) {
      throw new IllegalStateException("Cannot compile " + path, e);
    }
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
      String peppol = null;
      try {
        peppol = peppol(body);
      } catch (Exception e) {
        // The Peppol stylesheets assume schema-valid UBL (one CustomizationID, say). Mustang reports the
        // schema errors, so its report stands on its own and the file just gets no Peppol reading.
        System.err.println("Peppol rules failed: " + e);
      }
      int end = report.lastIndexOf("</validation>");
      if (peppol != null && end >= 0) report = report.substring(0, end) + peppol + report.substring(end);
      respond(exchange, 200, "application/xml; charset=utf-8", report);
    } catch (Throwable t) {
      t.printStackTrace();
      respond(exchange, 500, "text/plain", String.valueOf(t.getMessage()));
    }
  }

  /** Runs the Peppol rules over a UBL invoice or credit note. Returns null for anything else, PDFs included. */
  private static String peppol(byte[] body) throws Exception {
    XdmNode doc = parse(body);
    if (doc == null) return null;
    XPathCompiler xpath = SAXON.newXPathCompiler();
    String namespace = xpath.evaluateSingle("namespace-uri(/*)", doc).getStringValue();
    if (!UBL_INVOICE.equals(namespace) && !UBL_CREDIT_NOTE.equals(namespace)) return null;
    String customization = xpath.evaluateSingle("normalize-space((/*/*[local-name() = 'CustomizationID'])[1])", doc).getStringValue();

    Xslt30Transformer transformer = (SELF_BILLING.equals(customization) ? PEPPOL_SELF_BILLING : PEPPOL).load30();
    transformer.setGlobalContextItem(doc);
    XdmDestination svrl = new XdmDestination();
    transformer.applyTemplates(doc, svrl);

    StringBuilder findings = new StringBuilder();
    boolean valid = true;
    for (XdmItem item : xpath.evaluate("//*:failed-assert | //*:successful-report", svrl.getXdmNode())) {
      XdmNode node = (XdmNode) item;
      String flag = xpath.evaluateSingle("string(@flag)", node).getStringValue();
      String severity = flag.equals("fatal") || flag.equals("error") ? "error" : flag.equals("warning") ? "warning" : "notice";
      if (severity.equals("error")) valid = false;
      findings.append(finding(severity,
          xpath.evaluateSingle("string(@location)", node).getStringValue(),
          xpath.evaluateSingle("string(@test)", node).getStringValue(),
          xpath.evaluateSingle("normalize-space(*:text)", node).getStringValue()));
    }
    return "  <peppol rules=\"" + escape(PEPPOL_RULES) + "\">\n" + findings
        + "    <summary status=\"" + (valid ? "valid" : "invalid") + "\"/>\n  </peppol>\n";
  }

  /** Parses the body as XML without DTDs, so no external entity is ever fetched. Null if it is not XML. */
  private static XdmNode parse(byte[] body) {
    int i = 0;
    if (body.length >= 3 && (body[0] & 0xff) == 0xef && (body[1] & 0xff) == 0xbb && (body[2] & 0xff) == 0xbf) i = 3;
    while (i < body.length && Character.isWhitespace(body[i])) i++;
    if (i >= body.length || body[i] != '<') return null;
    try {
      SAXParserFactory factory = SAXParserFactory.newInstance();
      factory.setNamespaceAware(true);
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      XMLReader reader = factory.newSAXParser().getXMLReader();
      return SAXON.newDocumentBuilder().build(new SAXSource(reader, new InputSource(new ByteArrayInputStream(body))));
    } catch (Exception e) {
      return null;
    }
  }

  private static String finding(String severity, String location, String criterion, String text) {
    return "    <" + severity + " location=\"" + escape(location) + "\" criterion=\"" + escape(criterion) + "\">"
        + escape(text) + "</" + severity + ">\n";
  }

  private static String escape(String s) {
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
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
