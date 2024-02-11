const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const { CLOUDINARY_NAME, CLOUDINARY_KEY, CLOUDINARY_SECRET } = process.env;

cloudinary.config({
  cloud_name: CLOUDINARY_NAME,
  api_key: CLOUDINARY_KEY,
  api_secret: CLOUDINARY_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Determine the folder based on file properties or request data
    let folder;

    const userID = req.user._id.toString();

    const uniqueImgName = `${userID}_${file.originalname}`;

    if (file.fieldname === 'avatar') {
      folder = 'AniraKids_Avatars';
    } else if (file.fieldname === 'photos') {
      folder = 'AniraKids_Products';
    } else if (file.fieldname === 'certificates') {
      folder = 'DentistPortal_Certificates';
    } else {
      folder = 'misc';
    }

    // // Determine the desired quality based on file size
    // let desiredQuality = 100; // Default quality

    // // Calculate the desired quality based on file size
    // const fileSize = file.size;
    // if (fileSize > 10485760) {
    //   // If the file size exceeds 10MB, reduce quality to 90%
    //   desiredQuality = 90;
    // } else if (fileSize > 5242880) {
    //   // If the file size exceeds 5MB, reduce quality to 80%
    //   desiredQuality = 80;
    // }
    return {
      folder: folder,
      allowed_formats: ['jpg', 'jpeg', 'png'], // Adjust the allowed formats as needed
      public_id: uniqueImgName, // Use original filename as the public ID
      transformation: [
        // {width: 1000, crop: "scale"},
        // { quality: 90 },
        // {fetch_format: "auto"}
      ],
    };
  },
});

const upload = multer({ storage });

module.exports = upload;
