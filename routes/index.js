router.get('/login/google', async (req, res) => {

    const { data, error } = await supabase.auth.signInWithOAuth({

        provider: 'google',

        options: {

            redirectTo:
            process.env.NODE_ENV === 'production'
            ?
            'https://civicpulse-sygu.onrender.com/auth/callback'
            :
            'http://localhost:3000/auth/callback'

        }

    });


    if(error){
        console.log(error);
        return res.send("Google login failed");
    }


    res.redirect(data.url);

});