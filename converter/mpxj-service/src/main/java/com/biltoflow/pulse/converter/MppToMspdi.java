package com.biltoflow.pulse.converter;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import net.sf.mpxj.ProjectFile;
import net.sf.mpxj.reader.UniversalProjectReader;
import net.sf.mpxj.writer.FileFormat;
import net.sf.mpxj.writer.UniversalProjectWriter;

/**
 * MPP → MSPDI converter for BiltFlow Pulse.
 *
 * Binary .mpp is a closed format; mpxj (https://www.mpxj.org) is the only
 * maintained, lawful parser. This service accepts a multipart upload and
 * returns MSPDI (MS Project XML) which the Pulse API then maps.
 *
 * Licensing: mpxj is dual-licensed GPL/commercial — a commercial licence is
 * required for proprietary distribution (see converter/README.md).
 */
@SpringBootApplication
@RestController
public class MppToMspdi {

    @PostMapping("/convert")
    public ResponseEntity<?> convert(@RequestParam("file") MultipartFile file) throws Exception {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body("error: empty file");
        }
        byte[] bytes = file.getBytes();
        // UniversalProjectReader sniffs the real format (mpp/mpt/mpx) and
        // throws a readable exception for encrypted/unsupported files.
        ProjectFile project;
        try {
            project = new UniversalProjectReader().read(new ByteArrayInputStream(bytes));
        } catch (Exception e) {
            return ResponseEntity.unprocessableEntity().body(
                "error: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
        }
        if (project == null) {
            return ResponseEntity.unprocessableEntity().body("error: unreadable or unsupported project file");
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new UniversalProjectWriter(FileFormat.MSPDI).write(project, out);
        return ResponseEntity.ok()
            .header("Content-Type", "application/xml")
            .body(out.toString("UTF-8"));
    }

    public static void main(String[] args) {
        SpringApplication.run(MppToMspdi.class, args);
    }
}
