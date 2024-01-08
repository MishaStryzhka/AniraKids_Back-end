const sgMail = require('@sendgrid/mail');

// Встановлення API ключа SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Функція для відправки листа
const sendConfirmationEmail = (to, confirmationLink) => {
  const msg = {
    to: to,
    from: 'no-reply@anirakids.com', // Ваша електронна пошта, яку ви вказали при реєстрації на SendGrid
    subject: 'Підтвердження пошти',
    text: `Підтвердіть свою пошту за посиланням: ${confirmationLink}`,
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

module.exports = sendConfirmationEmail;
