'use strict';

const getWebsiteInfo = function(){
    const shortcutIcon = window.document.querySelector('head > link[rel="shortcut icon"]');
    const icon = shortcutIcon || Array.from(window.document.querySelectorAll('head > link[rel="icon"]')).find((icon) => Boolean(icon.href));
    const siteName = document.querySelector('head > meta[property="og:site_name"]');
    const title = siteName || document.querySelector('head > meta[name="title"]');

    return {
        title: title ? title.content : document.title,
        iconUrl: (icon && icon.href) || `${location.origin}/favicon.ico`
    };
};

const IFRAME_ID = '__THETA_WALLET_CONNECT__';

class ThetaWalletConnect{
    constructor() {
        this._onLoad = null;
        this._isConnected = false;

        this._callbacks = {};

        this._bridge_iframe = null;

        this._r = null;
        this._requester = null;

        this._publicConfig = null;
    }

    connect(){
        const promise = new Promise((resolve, reject) => {
            if(this._isConnected){
                resolve(true);
                return;
            }

            const requester = Object.assign({}, getWebsiteInfo(),{
                origin: window.location.origin,
            });
            this._requester = requester;
            this._r = encodeURIComponent(btoa(JSON.stringify(requester)));

            let iframe = document.getElementById(IFRAME_ID);
            if(!iframe){
                // We already have injected our frame
                iframe = document.createElement('iframe');
                iframe.id = IFRAME_ID;
                iframe.style.display = 'none';
                iframe.onload = function(){
                    this._isConnected = true;
                    this._bridge_iframe = iframe;

                    resolve(true);
                }.bind(this);
                iframe.onerror = function(){
                    reject(new Error('Failed to connect to Theta Wallet.'));
                };
                iframe.src = `https://wallet.thetatoken.org/theta-wallet-connect.html`;
                document.body.appendChild(iframe);

                this._setUpMessageListener();
            }
            else{
                resolve(true);
            }
        });
        this._initPromise = promise;
        return promise;
    }

    disconnect(){
        const promise = new Promise((resolve, reject) => {
            let iframe = document.getElementById(IFRAME_ID);
            if(iframe){
                iframe.parentNode.removeChild(iframe);

                this._isConnected = false;
                this._bridge_iframe = null;
                this._publicConfig = null;
            }
            this._removeMessageListener();

            resolve(true);
        });
        return promise;
    }

    isConnected(){
        return (this._isConnected && this._publicConfig !== null);
    }

    requestAccounts(){
        return this._sendRPCRequestToContentScriptBridge('requestAccounts',[], null);
    }

    sendTransaction(transaction){
        if(!transaction){
            throw new Error('transaction must be a thetajs Transaction.');
        }
        if(!transaction.toJson){
            throw new Error('transaction must be a thetajs Transaction.');
        }

        const transactionRequest = transaction.toJson();
        return this._sendRPCRequestToContentScriptBridge('sendTransaction',[{transactionRequest: transactionRequest}], null);
    }

    getChainId(){
        return this._publicConfig['chainId'];
    }

    isUnlocked(){
        return this._publicConfig['isUnlocked'];
    }

    _registerCallback(id, cb){
        this._callbacks[id] = cb;
    }

    _buildRPCRequest(method, params){
        return {
            jsonrpc: '2.0',
            method: method,
            params: params,
            id: Date.now()
        };
    }

    _buildDefaultRPCCallback(resolve, reject) {
        return (error, result) => {
            if (error) {
                reject(new Error(error));
                return;
            }

            resolve(result);
        };
    };

    _sendRPCRequestToContentScriptBridge(method, params, callback = null){
        return new Promise((resolve, reject) => {
            const cb = (callback ? callback : this._buildDefaultRPCCallback(resolve, reject));
            const request = this._buildRPCRequest(method, params);
            request.metadata = {
                requester: this._requester
            };

            this._registerCallback(request.id, cb);

            this._bridge_iframe.contentWindow.postMessage({
                target: 'theta-wallet.contentscript-forwarder',
                data: request
            }, '*');
        });
    };

    _handleMessage(event){
        // We always pass an object
        if(!event.data || (typeof event.data !== 'object')){
            return;
        }

        // We always pass target
        if(!event.data.target){
            return;
        }

        if(event.data.target === 'theta-wallet.connect'){
            const {id, error, result, method, params} = event.data.data;

            if(method === 'updateThetaWalletPublicConfig'){
                const newConfig = params[0]['publicConfig'];

                if((newConfig && this._publicConfig) && (newConfig.chainId !== this.getChainId()));
                this._publicConfig = params[0]['publicConfig'];

                return;
            }

            if(id !== undefined && (result || error)){
                // This is a response from a previous request
                const cb = this._callbacks[id];

                if(cb){
                    // RPC spec has an error as an object
                    const errorMsg = (error ? error.message : null);

                    cb(errorMsg, result);
                }
            }
        }
    }

    _setUpMessageListener(){
        window.addEventListener('message', this._handleMessage, false);
    }

    _removeMessageListener(){
        window.removeEventListener('message', this._handleMessage, false);
    }
}

var index = new ThetaWalletConnect();

module.exports = index;
