$(function() {
  $('#load-player-btn').click(function() {
    // disable the button and get the URL
    $('#load-player-btn').html('<span class="glyphicon glyphicon-refresh glyphicon-refresh-animate"></span> Loading...');
    $('#load-player-btn').attr('disabled', 'disabled');
    getUrl();
  });

  // retrieves the URL from the app for the running live stream
  function getUrl() {
    $.ajax({
      type: "GET",
      url: "/url",
      success: function(data, textStatus, xhr) {
        console.log(xhr);
        if (xhr.status == 200) {
          // give the stream some time
          console.log(data);
          setTimeout(loadPlayer, 30000, data);
        }
        else {
          // need to retry until we get a URL
          setTimeout(getUrl, 2000);
        }
      }
    });
  }

  // loads the provided player, with the URL
  function loadPlayer(url) {
    // re-enable the button to load a different player
    $('#load-player-btn').html('Load Player');
    $('#load-player-btn').removeAttr('disabled');

    var $accountInput = $('#account-input');
    var $playerInput = $('#player-input');

    // create our player
    var playerTemplate = '<video' + 
                        '  id="livePlayer"' + 
                        '  data-account="' + $accountInput.val() + '"' +
                        '  data-player="' + $playerInput.val() + '"' +
                        '  data-embed="default"' + 
                        '  width=100%' +
                        '  height=270px' +
                        '  data-live-url="' + url + '"' +
                        '  class="video-js" controls></video>';
    var $player = $(playerTemplate);
    $('#playerHolder').empty().append($player);

    // and inject the script
    var playerScript = document.createElement('script');
    playerScript.type = 'text/javascript';
    playerScript.src = '//players.brightcove.net/' + $accountInput.val() + '/' + $playerInput.val() + '_default/index.min.js';
    $('head').append(playerScript);

    preparePlayer();
  }

  // have to do this to get around me being stupid and not getting onload to work correctly.
  function preparePlayer() {
    if (window.videojs) {
      videojs('livePlayer').ready(function() {
        var player = this;
        console.log('loaded');

        player.height(player.width()*9/16);
        $(window).resize(function(event) {
          player.height(player.width()*9/16);
        });

        player.src([
          {type: 'application/x-mpegURL', src: $(player.el()).data('live-url')}
        ]);

        // and play it
        player.play();
      });
    }
    else
      setTimeout(preparePlayer, 100);
  }
});