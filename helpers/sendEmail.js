const sgMail = require('@sendgrid/mail');

// Встановлення API ключа SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Функція для відправки листа
const sendEmail = ({ to, text, html, subject }) => {
  const msg = {
    to: to,
    from: 'no-reply@anirakids.com', // Ваша електронна пошта, яку ви вказали при реєстрації на SendGrid
    subject,
    text: text,
    html: html,
  };

  sgMail
    .send(msg)
    .then(() => {
      console.log('Email sent');
    })
    .catch(error => {
      console.error(error);
    });
};

module.exports = sendEmail;

// ================
// =====SEZNAM.CZ==
// ================

// const nodemailer = require('nodemailer');

// async function sendEmail({ from, to, subject, html, text }) {
//   const transporter = nodemailer.createTransport({
//     host: 'smtp.seznam.cz',
//     port: 465,
//     auth: {
//       user: 'no-reply',
//       pass: 'Karina2022',
//     },
//   });
//   // 86qW5:*Kq.RmBpyo
//   await transporter.sendMail({ from, to, subject, html, text });

//   // verify connection configuration
//   transporter.verify(function (error, success) {
//     if (error) {
//       console.log(error);
//     } else {
//       console.log('Server is ready to take our messages');
//     }
//   });
// }

// module.exports = sendEmail;
