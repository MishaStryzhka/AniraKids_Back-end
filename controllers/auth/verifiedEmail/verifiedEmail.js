const { sendEmail } = require('../../../helpers');
const { translations } = require('./translations');

const verifiedEmail = async (req, res) => {
  const { user } = req;
  // OAuth and older accounts may not have a saved language.
  const language = ['cs', 'en', 'uk'].includes(user.language) ? user.language : 'cs';
  const copy = translations[language];

  await sendEmail({
    to: user.email,
    subject: copy.email_confirmation,
    html: `<!DOCTYPE html>
    <html lang="${language}">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Email Confirmation</title>
    
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
            <link
                href="https://fonts.googleapis.com/css2?family=Cormorant+SC:wght@400;700&family=Open+Sans:ital,wght@0,700;1,700&display=swap"
                rel="stylesheet"
            />
        </head>
        <body>
            <header style="text-align:center;padding:28px 16px;border-bottom:1px solid #ebdad1">
                <a href="https://anirakids.cz" style="font-family:Georgia,serif;font-size:30px;color:#403a37;text-decoration:none">ANIRAK</a>
                <p style="font-family:Arial,sans-serif;font-size:14px;line-height:2">
                    <a href="https://anirakids.cz/saty" style="color:#403a37;margin:0 12px">Šaty</a>
                    <a href="https://anirakids.cz/obleky" style="color:#403a37;margin:0 12px">Obleky</a>
                    <a href="https://anirakids.cz/pronajem" style="color:#403a37;margin:0 12px">Pronájem</a>
                    <a href="https://anirakids.cz/ucet" style="color:#403a37;margin:0 12px">Můj účet</a>
                </p>
            </header>
            <main>
                <div
                    style="
                        height: 10px;
                        background: linear-gradient(
                            to bottom,
                            rgba(17, 17, 17, 0.1),
                            rgba(255, 255, 255, 0)
                        );
                    "
                ></div>
                <h1
                    style="
                        font-size: 32px;
                        line-height: 1.17;
                        text-transform: uppercase;
                        margin-top: 54px;
                        font-family: 'Cormorant SC';
                        font-weight: 700;
                        text-align: center;
                        margin-bottom: 16px;
                        color: #000;
                    "
                >
                    ${copy.email_confirmation}
                </h1>
                <p
                    style="
                        text-align: center;
                        margin-top: 50px;
    
                        font-family: 'Open Sans', sans-serif;
                        font-size: 14px;
                        font-weight: 400;
                        line-height: 1.43;
                        color: #000;
                    "
                >
                    ${copy.confirmation_message}
                </p>
    
                <a
                    style="display: grid; margin-top: 32px; text-decoration: none"
                    href="${process.env.FRONTEND_URL}/confirmEmail?token=${
      user.token
    }"
                    ><button
                        style="
                            background-color: transparent;
    
                            box-sizing: border-box;
                            width: 305px;
                            padding: 14px 40px;
                            margin: 32px auto;
    
                            border-radius: 2px;
                            border: 1px solid rgb(108, 97, 88);
    
                            color: rgb(108, 97, 88);
    
                            font-family: 'Open Sans', sans-serif;
                            font-weight: 700;
                            font-size: 14px;
                            line-height: 143%;
                            text-transform: uppercase;
                            place-content: center;
                        "
                    >
                        ${copy.confirm_button}
                    </button></a
                >
            </main>
            <footer
                style="
                    padding: 40px 0;
                    margin-top: 22px;
                    width: 100%;
                    background-color: #ebdad1;
                    text-align: center;
                "
            >
                <p>ANIRAK © ${new Date().getFullYear()} · GlamGarb Rentals s.r.o.</p>
            </footer>
        </body>
    </html>    
    `,
  });

  res.status(200).json({
    message: 'Email confirmation sent successfully.',
  });
};

module.exports = verifiedEmail;
