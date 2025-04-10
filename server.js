const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const socketIo = require("socket.io");
const archiver = require("archiver");
//const ffmpegPath = require('ffmpeg-static');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const ytDlpPath = path.resolve(__dirname, "yt-dlp");
//const ffmpegPath = "C:\\ffmpeg-7.1.1-full_build\\bin\\ffmpeg.exe"; 
const downloadPath = path.join(__dirname, 'downloads');

// Asegurarse de que la carpeta de descargas exista
if (!fs.existsSync(downloadPath)) {
  fs.mkdirSync(downloadPath);
}

app.use(cors());
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, 'public')));

let ytDlpProcess = null;

// Ruta principal
app.get("/", (req, res) => {
  res.render("index");
});

// Iniciar la descarga
app.post("/start-download", (req, res) => {
  const url = req.body.url;

  if (!url) {
    return res.status(400).json({ error: "URL es requerida" });
  }

  const args = [
    "-f", "best",
    "-o", `${downloadPath}/%(title)s.%(ext)s`, 
    url
  ];

  ytDlpProcess = spawn(ytDlpPath, args);

  ytDlpProcess.stdout.on("data", (data) => {
    const progressData = data.toString();
    const matchFileName = progressData.match(/Destination: (.+)/);
    if (matchFileName) {
      const fileName = path.basename(matchFileName[1]);
      io.emit("fileDownloaded", fileName);
    }
  });

  ytDlpProcess.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  ytDlpProcess.on("close", (code) => {
    if (code === 0) {
      console.log("Descarga completada");
    } else {
      console.log("Error en la descarga");
    }
  });

  res.json({ message: "Descarga en progreso..." });
});

// Función para crear el archivo ZIP con todos los archivos descargados
app.get("/download-all", (req, res) => {
  const zipPath = path.join(__dirname, 'downloads.zip');
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Nivel de compresión
  });

  output.on('close', function() {
    console.log(`Archivo ZIP creado: ${archive.pointer()} bytes`);

    // Después de la descarga, eliminar la carpeta "downloads"
    res.download(zipPath, 'downloads.zip', (err) => {
      if (err) {
        console.error("Error al descargar el archivo:", err);
      }

      // Eliminar el archivo ZIP después de que se haya descargado
      fs.unlinkSync(zipPath);

      // Borrar todo el contenido de la carpeta 'downloads'
      fs.readdirSync(downloadPath).forEach(file => {
        const filePath = path.join(downloadPath, file);
        fs.unlinkSync(filePath); // Eliminar cada archivo
      });
    });
  });

  archive.on('error', function(err) {
    res.status(500).send({ error: err.message });
  });

  archive.pipe(output);

  // Agregar todos los archivos en la carpeta 'downloads' al archivo ZIP
  fs.readdirSync(downloadPath).forEach(file => {
    const filePath = path.join(downloadPath, file);
    archive.file(filePath, { name: file });
  });

  archive.finalize();
});

// Detener la descarga
app.post("/stop-download", (req, res) => {
  if (ytDlpProcess) {
    ytDlpProcess.kill("SIGINT");
    ytDlpProcess = null;
    res.json({ message: "Descarga detenida" });
  } else {
    res.status(400).json({ error: "No hay descarga en progreso" });
  }
});

// Servir archivos estáticos
app.use("/downloads", express.static(downloadPath));

// Iniciar servidor
server.listen(3000, () => {
  console.log("Servidor escuchando en http://localhost:3000");
});
