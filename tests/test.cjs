const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function createPdf() {
  const pdfDoc = await PDFDocument.create();
  const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const fontSize = 14;
  
  page.drawText('This is a test PDF document. It contains information about a fictional company called TechCorp.', {
    x: 50,
    y: height - 4 * fontSize,
    size: fontSize,
    font: timesRomanFont,
    color: rgb(0, 0, 0),
  });

  page.drawText('TechCorp was founded in 2015 by John Doe.', {
     x: 50,
     y: height - 6 * fontSize,
     size: fontSize,
     font: timesRomanFont,
  });

  page.drawText('The company specializes in Artificial Intelligence and Cloud Computing.', {
     x: 50,
     y: height - 8 * fontSize,
     size: fontSize,
     font: timesRomanFont,
  });
  
  page.drawText('TechCorp\'s flagship product is called CloudBrain. It was released in 2020.', {
     x: 50,
     y: height - 10 * fontSize,
     size: fontSize,
     font: timesRomanFont,
  });

  page.drawText('The CEO of TechCorp is currently Jane Smith.', {
     x: 50,
     y: height - 12 * fontSize,
     size: fontSize,
     font: timesRomanFont,
  });

  page.drawText('Our primary revenue is 5 million dollars per year.', {
     x: 50,
     y: height - 14 * fontSize,
     size: fontSize,
     font: timesRomanFont,
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  fs.writeFileSync('./test_upload.pdf', pdfBytes);
}

createPdf();
