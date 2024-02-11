const sharp = require('sharp');

const imageProcessingMiddleware = async (req, res, next) => {
  console.log('first');
  console.log('req', req.files);

  try {
    if (!req?.files?.photos || req?.files?.photos?.length === 0) {
      return next();
    }

    // Масив для зберігання оброблених файлів
    const processedFiles = [];

    // Обробляємо кожен файл окремо
    for (const file of req.files.photos) {
      console.log('file.size', file.size);

      //   // Зчитуємо файл з потоку
      //   const inputImageBuffer = await sharp(file.buffer)
      //     .jpeg() // Необов'язково: конвертуємо в JPEG формат (якщо вхідне зображення не у цьому форматі)
      //     .toBuffer();

      //   console.log('inputImageBuffer', inputImageBuffer);

      // Змінюємо якість зображення
      const outputImageBuffer = await sharp(file)
        .jpeg({ quality: 30 }) // Новий рівень якості зображення (від 0 до 100)
        .toBuffer();

      console.log('outputImageBuffer', outputImageBuffer);

      // Додаємо оброблений файл до масиву оброблених файлів
      processedFiles.push({
        buffer: outputImageBuffer,
        originalname: file.originalname,
      });
    }

    // Оновлюємо файли в запиті з обробленими зображеннями
    req.files = processedFiles;

    next(); // Переходимо до наступної обробки (наприклад, завантаження на Cloudinary)
  } catch (error) {
    console.error('Error processing images:', error);
    next(error); // Передаємо помилку обробки зображень далі
  }
};

module.exports = imageProcessingMiddleware;
