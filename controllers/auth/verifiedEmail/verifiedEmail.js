const { sendEmail } = require('../../../helpers');
const { translations } = require('./translations');

const verifiedEmail = async (req, res) => {
  const { user } = req;

  sendEmail({
    to: user.email,
    subject: translations[user.language].email_confirmation,
    html: `<!DOCTYPE html>
    <html lang="en">
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
            <header>
                <div style="display: flex; margin: 0 auto; width: max-content">
                    <a
                        style="
                            font-family: 'Open Sans Hebrew', sans-serif;
                            font-size: 14px;
                            font-weight: 700;
                            line-height: 1.43;
                            text-decoration: none;
                            text-transform: uppercase;
                            padding: 8px 16px;
                            color: #000;
                            color: #000;
                        "
                        href="https://anirakids.cz/forWomen"
                        >${translations[user.language].header_womens_wear}</a
                    >
                    <a
                        style="
                            font-family: 'Open Sans Hebrew', sans-serif;
                            font-size: 14px;
                            font-weight: 700;
                            line-height: 1.43;
                            text-decoration: none;
                            text-transform: uppercase;
                            padding: 8px 16px;
                            color: #000;
                            color: #000;
                        "
                        href="https://anirakids.cz/forMen"
                        >${translations[user.language].header_mens_suits}</a
                    >
                    <a
                        style="
                            font-family: 'Open Sans Hebrew', sans-serif;
                            font-size: 14px;
                            font-weight: 700;
                            line-height: 1.43;
                            text-decoration: none;
                            text-transform: uppercase;
                            padding: 8px 16px;
                            color: #000;
                            color: #000;
                        "
                        href="https://anirakids.cz/forChildren"
                        >${translations[user.language].header_childrens_wear}</a
                    >
                    <a
                        style="
                            font-family: 'Open Sans Hebrew', sans-serif;
                            font-size: 14px;
                            font-weight: 700;
                            line-height: 1.43;
                            text-decoration: none;
                            text-transform: uppercase;
                            padding: 8px 16px;
                            color: #000;
                            color: #000;
                        "
                        href="https://anirakids.cz/decorAndToys"
                        >${translations[user.language].header_decor_and_toys}</a
                    >
                    <a
                        style="
                            font-family: 'Open Sans Hebrew', sans-serif;
                            font-size: 14px;
                            font-weight: 700;
                            line-height: 1.43;
                            text-decoration: none;
                            text-transform: uppercase;
                            padding: 8px 16px;
                            color: #000;
                            color: #000;
                        "
                        href="https://anirakids.cz/aboutUs"
                        >${translations[user.language].header_about_us}</a
                    >
                </div>
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
                    ${translations[user.language].email_confirmation}
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
                    ${translations[user.language].confirmation_message}
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
                        ${translations[user.language].confirm_button}
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
                <p>AniraKids © 2023 - 2024 GlamGarb Rentals s.r.o</p>
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
